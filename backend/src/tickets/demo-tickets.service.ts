import { Injectable, type OnModuleInit } from '@nestjs/common';
import type {
  Prisma,
  ServiceType,
  TicketChannel,
  TicketEventType,
  TicketPriority,
  TicketStage,
  User,
} from '@prisma/client';
import { builtInRoleId } from '../auth/permissions';
import { coverageOf } from '../catalog/coverage';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { type AfterCommit, DemoService } from '../demo/demo.service';
import { businessMinutesBetween } from '../service-rules/business-calendar';
import { RegionsService } from '../service-rules/regions.service';
import { ServiceRulesService } from '../service-rules/service-rules.service';
import { slaFields } from './sla';
import { SlaTimersService } from './sla-timers.service';
import { TicketsService } from './tickets.service';

/**
 * 60 fictional tickets for the demo company, spread over the last month and
 * across every stage, with timelines, SLA outcomes and routing that match the
 * demo regions, skills and SLA policies. Deterministic for a given date.
 */

const FLOW: TicketStage[] = [
  'NEW',
  'TRIAGED',
  'ASSIGNED',
  'ACCEPTED',
  'ON_SITE',
  'IN_PROGRESS',
  'RESOLVED',
  'VERIFIED',
  'CLOSED',
];

/** Final stage of each demo ticket: 24 open, 33 closed, 3 cancelled. */
const PLAN: TicketStage[] = [
  ...Array<TicketStage>(3).fill('NEW'),
  ...Array<TicketStage>(2).fill('TRIAGED'),
  ...Array<TicketStage>(4).fill('ASSIGNED'),
  ...Array<TicketStage>(3).fill('ACCEPTED'),
  ...Array<TicketStage>(2).fill('ON_SITE'),
  ...Array<TicketStage>(4).fill('IN_PROGRESS'),
  ...Array<TicketStage>(2).fill('ON_HOLD'),
  ...Array<TicketStage>(3).fill('RESOLVED'),
  'VERIFIED',
  ...Array<TicketStage>(33).fill('CLOSED'),
  ...Array<TicketStage>(3).fill('CANCELLED'),
];

const ISSUES: Record<string, [string, string][]> = {
  JX: [
    [
      'Toggle plate cracked, plant stopped',
      'Replaced toggle plate and seat; ran 30 minutes under load.',
    ],
    [
      'Jaw dies worn, product oversize',
      'Turned the fixed die and replaced the swing die; closed side setting reset to 90 mm.',
    ],
    [
      'Knocking noise from eccentric shaft',
      'Bearing housing bolts loose; re-torqued and re-greased. Noise gone.',
    ],
  ],
  CX: [
    [
      'Heavy vibration, output size drifting',
      'Mantle liner worn to 11 mm; replaced mantle and bowl liner.',
    ],
    ['Lube oil pressure alarm', 'Filter element choked; replaced filter and topped up oil.'],
    ['Crusher stalls under full feed', 'Hydraulic setting system leaking; replaced seal kit.'],
  ],
  V: [
    ['Rotor tips wearing unevenly', 'Rebalanced rotor and replaced the tip set.'],
    [
      'Feed tube blocked, sand output low',
      'Replaced worn feed tube; cleared build-up in the rotor.',
    ],
  ],
  VS: [
    ['Screen mesh torn on top deck', 'Replaced 40 mm mesh panels and re-tensioned the deck.'],
    ['Screen vibrating unevenly', 'Replaced broken spring set on the feed end.'],
  ],
  MCU: [
    ['Hydraulic hose burst on tracks', 'Replaced hose kit and bled the circuit.'],
    ['Track roller seized', 'Replaced two track rollers.'],
  ],
  HMP: [
    [
      'Burner fails to ignite after shutdown',
      'Ignition electrode fouled; replaced electrode and cleaned nozzle.',
    ],
    [
      'Bag filter pressure too high',
      'Replaced 10 filter bags; differential pressure back to normal.',
    ],
  ],
  BC: [
    ['Conveyor belt running off-centre', 'Realigned tail pulley and replaced two idlers.'],
    ['Belt slipping on head pulley', 'Replaced pulley lagging and adjusted take-up.'],
  ],
};
const HOLD_REASONS = [
  'Waiting for spare parts from the Hosur store',
  'Customer asked us to return after the production run',
];
const CANCEL_REASONS = [
  'Customer fixed it themselves before we arrived',
  'Logged twice by the customer; the other ticket covers it',
  'Machine is being replaced; no repair wanted',
];
const NOTES = [
  'Called the site supervisor; plant is running at reduced output until we arrive.',
  'Spares loaded in the van from the Bengaluru store.',
  'Customer asked for the old parts to be left on site.',
];
const CHANNELS: TicketChannel[] = ['PHONE', 'PHONE', 'WHATSAPP', 'EMAIL', 'PORTAL'];
const PRIORITIES: TicketPriority[] = ['HIGH', 'MEDIUM', 'CRITICAL', 'LOW', 'HIGH', 'MEDIUM'];

const MINUTE = 60_000;
const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * MINUTE);
const family = (itemCode: string | null) => (itemCode ?? 'JX').split('-')[0];

interface Step {
  type: TicketEventType;
  at: Date;
  actorId: string | null;
  fromStage?: TicketStage;
  toStage?: TicketStage;
  note?: string;
  data?: Prisma.InputJsonValue;
}

type DemoMachine = Prisma.EquipmentGetPayload<{
  include: { customer: { include: { sites: true; contacts: true } } };
}>;

interface PlanContext {
  tx: Prisma.TransactionClient;
  now: Date;
  machines: DemoMachine[];
  engineers: User[];
  manager: User | null;
  desk: User[];
  breakdown: ServiceType;
  preventive: ServiceType;
  engineersFor: (itemCode: string | null) => string[];
}

@Injectable()
export class DemoTicketsService implements OnModuleInit {
  constructor(
    private readonly demo: DemoService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tickets: TicketsService,
    private readonly rules: ServiceRulesService,
    private readonly regions: RegionsService,
    private readonly timers: SlaTimersService,
  ) {}

  onModuleInit(): void {
    this.demo.register({
      key: 'tickets',
      count: () => this.prisma.ticket.count({ where: { isDemo: true } }),
      load: (tx, now) => this.load(tx, now),
      clear: (tx) => this.clear(tx),
    });
  }

  private async clear(tx: Prisma.TransactionClient): Promise<AfterCommit> {
    const tickets = await tx.ticket.findMany({
      where: { isDemo: true },
      select: { id: true, attachments: { select: { storageKey: true } } },
    });
    await tx.ticket.deleteMany({ where: { isDemo: true } });
    return async () => {
      await this.timers.cancel(tickets.map((t) => t.id));
      for (const key of tickets.flatMap((t) => t.attachments.map((a) => a.storageKey))) {
        await this.storage.remove(key);
      }
    };
  }

  private async load(tx: Prisma.TransactionClient, now: Date): Promise<AfterCommit> {
    const [machines, users, serviceTypes, skills] = await Promise.all([
      tx.equipment.findMany({
        where: { source: 'DEMO', customerId: { not: null } },
        orderBy: { serialNo: 'asc' },
        include: {
          customer: {
            include: {
              sites: { take: 1, orderBy: { createdAt: 'asc' } },
              contacts: { where: { isPrimary: true }, take: 1 },
            },
          },
        },
      }),
      tx.user.findMany({ where: { isDemo: true, status: 'ACTIVE' }, orderBy: { name: 'asc' } }),
      tx.serviceType.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
      tx.skillTag.findMany({ include: { users: true } }),
    ]);
    if (!machines.length || !serviceTypes.length) return async () => {};

    const byRole = (key: string) => users.filter((u) => u.roleId === builtInRoleId(key));
    const engineers = byRole('ENGINEER');
    const manager = byRole('SERVICE_MANAGER')[0] ?? null;
    const desk = [...byRole('CALL_CENTER'), ...byRole('CS_SUPPORT')];
    const breakdown = serviceTypes.find((t) => t.name === 'Breakdown') ?? serviceTypes[0];
    const preventive = serviceTypes.find((t) => t.name === 'Preventive maintenance') ?? breakdown;
    const engineersFor = (itemCode: string | null) => {
      const skilled = skills
        .filter((s) => itemCode && s.equipmentModels.includes(itemCode))
        .flatMap((s) => s.users.map((u) => u.userId))
        .filter((id) => engineers.some((e) => e.id === id));
      return skilled.length ? skilled : engineers.map((e) => e.id);
    };

    // Build every ticket's timeline first, then allocate numbers in logged order.
    const ctx: PlanContext = {
      tx,
      now,
      machines,
      engineers,
      manager,
      desk,
      breakdown,
      preventive,
      engineersFor,
    };
    const plans = [];
    for (const [i, finalStage] of PLAN.entries()) plans.push(await this.plan(i, finalStage, ctx));

    plans.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const created: {
      id: string;
      slaDueAt: Date | null;
      slaRiskAt: Date | null;
      respondedAt: Date | null;
    }[] = [];

    for (const p of plans) {
      const cover = coverageOf(p.machine, p.createdAt);
      const sla = await this.rules.slaFor(cover.coverage, p.priority, p.createdAt, tx);
      const respondedAt = p.times.ACCEPTED ?? null;
      const resolvedAt = p.times.RESOLVED ?? null;
      const state = {
        stage: p.finalStage,
        respondedAt,
        resolvedAt,
        ...sla,
      };
      let hold: Partial<Prisma.TicketUncheckedCreateInput> = {};
      if (p.finalStage === 'ON_HOLD') {
        const { rules, timeZone } = await this.rules.clock(sla.slaCalendarId, tx);
        const pausedAt = p.times.ON_HOLD!;
        hold = {
          stageBeforeHold: 'IN_PROGRESS',
          holdReason: p.steps[p.steps.length - 1].note ?? null,
          pausedAt,
          responseLeftMin: null,
          resolutionLeftMin: businessMinutesBetween(pausedAt, sla.resolutionDueAt, rules, timeZone),
        };
      }
      const fields = slaFields(state);
      const number = await this.tickets.nextNumber(tx, p.createdAt);
      const ticket = await tx.ticket.create({
        data: {
          number,
          title: p.title,
          description:
            p.channel === 'AMC_VISIT'
              ? 'Planned AMC service visit.'
              : `Reported by ${p.customer.contacts[0]?.fullName ?? 'the site'} by ${p.channel.toLowerCase()}.`,
          customerId: p.customer.id,
          siteId: p.site?.id ?? null,
          equipmentId: p.machine.id,
          contactId: p.customer.contacts[0]?.id ?? null,
          serviceTypeId: p.serviceTypeId,
          priority: p.priority,
          channel: p.channel,
          coverage: cover.coverage,
          coverageUntil: cover.until,
          stage: p.finalStage,
          regionId: p.region?.id ?? null,
          areaManagerId: p.region?.areaManagerId ?? null,
          engineerId: p.engineerId,
          createdById: p.creator,
          ...sla,
          ...fields,
          ...hold,
          respondedAt,
          resolvedAt,
          verifiedAt: p.times.VERIFIED ?? null,
          closedAt: p.times.CLOSED ?? null,
          cancelledAt: p.times.CANCELLED ?? null,
          // A clock is judged at the moment it stopped: answered/resolved, paused, cancelled, or now.
          responseBreached: (respondedAt ?? p.times.CANCELLED ?? now) > sla.responseDueAt,
          resolutionBreached:
            (resolvedAt ?? p.times.ON_HOLD ?? p.times.CANCELLED ?? now) > sla.resolutionDueAt,
          // Sticky history (SB-M8): matches the live flags at seed time.
          responseBreachedEver: (respondedAt ?? p.times.CANCELLED ?? now) > sla.responseDueAt,
          resolutionBreachedEver:
            (resolvedAt ?? p.times.ON_HOLD ?? p.times.CANCELLED ?? now) > sla.resolutionDueAt,
          isDemo: true,
          createdAt: p.createdAt,
          events: {
            createMany: {
              data: p.steps.map((s) => ({
                type: s.type,
                actorId: s.actorId,
                fromStage: s.fromStage ?? null,
                toStage: s.toStage ?? null,
                note: s.note ?? null,
                data: s.data,
                createdAt: s.at,
              })),
            },
          },
        },
        select: { id: true, slaDueAt: true, slaRiskAt: true, respondedAt: true },
      });
      if (ticket.slaDueAt) created.push(ticket);
    }

    return async () => {
      for (const ticket of created) await this.timers.sync(ticket);
    };
  }

  /** One ticket's details and timeline, before it has a number. */
  private async plan(i: number, finalStage: TicketStage, ctx: PlanContext) {
    const { tx, now, machines, engineers, manager, desk, breakdown, preventive, engineersFor } =
      ctx;
    const machine = machines[(i * 7) % machines.length];
    const customer = machine.customer!;
    const site = customer.sites[0] ?? null;
    const issues = ISSUES[family(machine.itemCode)] ?? ISSUES.JX;
    const [title, fix] = issues[i % issues.length];
    const isPreventive = i % 9 === 4;
    const serviceType = isPreventive ? preventive : breakdown;
    const priority: TicketPriority = isPreventive ? 'LOW' : PRIORITIES[i % PRIORITIES.length];
    const channel: TicketChannel = isPreventive ? 'AMC_VISIT' : CHANNELS[i % CHANNELS.length];
    const region = await this.regions.forPincode(site?.pincode, tx);
    const choices = engineersFor(machine.itemCode);
    const engineerId = choices.length ? choices[i % choices.length] : null;
    const assigner = region?.areaManagerId ?? manager?.id ?? null;
    const creator = desk.length ? desk[i % desk.length].id : null;

    // How far along the flow it got; ON_HOLD and CANCELLED pause/stop part-way.
    const reached =
      finalStage === 'ON_HOLD'
        ? FLOW.indexOf('IN_PROGRESS')
        : finalStage === 'CANCELLED'
          ? i % 2
          : FLOW.indexOf(finalStage);
    const durations = [
      0,
      5 + (i % 4) * 5, // acknowledged
      10 + (i % 5) * 8, // assigned
      15 + (i % 6) * 25, // accepted (some miss a 2-hour response target)
      60 + (i % 5) * 40, // on site
      10, // started
      90 + (i % 7) * 60, // resolved
      60 + (i % 3) * 120, // verified
      30, // closed
    ];
    const closedDaysAgo = 2 + ((i * 13) % 27);
    const open = !['CLOSED', 'CANCELLED'].includes(finalStage);
    let start = open
      ? at(now, -(durations.slice(0, reached + 1).reduce((a, b) => a + b, 0) + 20 + (i % 5) * 35))
      : at(now, -(closedDaysAgo * 24 * 60 + (i % 7) * 60));
    if (['RESOLVED', 'VERIFIED'].includes(finalStage)) start = at(start, -24 * 60);

    const steps: Step[] = [];
    let t = start;
    steps.push({
      type: 'CREATED',
      at: t,
      actorId: creator,
      toStage: 'NEW',
      data: { channel },
    });
    steps.push({
      type: 'ROUTED',
      at: at(t, 0.02),
      actorId: null,
      data: region
        ? {
            regionId: region.id,
            regionName: region.name,
            areaManagerId: region.areaManagerId,
          }
        : { regionId: null, pincode: site?.pincode ?? null },
    });
    const times: Partial<Record<TicketStage, Date>> = { NEW: t };
    for (let s = 1; s <= reached; s++) {
      t = at(t, durations[s]);
      const stage = FLOW[s];
      times[stage] = t;
      const engineerStep = ['ACCEPTED', 'ON_SITE', 'IN_PROGRESS', 'RESOLVED'].includes(stage);
      steps.push({
        type: stage === 'ASSIGNED' ? 'ASSIGNED' : 'STAGE_CHANGED',
        at: t,
        actorId: engineerStep
          ? engineerId
          : ['VERIFIED', 'CLOSED'].includes(stage)
            ? (manager?.id ?? null)
            : assigner,
        fromStage: FLOW[s - 1],
        toStage: stage,
        note: stage === 'RESOLVED' ? fix : undefined,
        data:
          stage === 'ASSIGNED'
            ? {
                action: 'assign',
                engineerId,
                engineerName: engineers.find((e) => e.id === engineerId)?.name ?? null,
              }
            : { action: stage.toLowerCase() },
      });
      if (stage === 'IN_PROGRESS' && i % 3 === 0) {
        steps.push({
          type: 'NOTE',
          at: at(t, 20),
          actorId: engineerId,
          note: NOTES[i % NOTES.length],
        });
      }
    }
    if (finalStage === 'ON_HOLD') {
      t = at(t, 30);
      times.ON_HOLD = t;
      steps.push({
        type: 'STAGE_CHANGED',
        at: t,
        actorId: engineerId,
        fromStage: 'IN_PROGRESS',
        toStage: 'ON_HOLD',
        note: HOLD_REASONS[i % HOLD_REASONS.length],
        data: { action: 'hold' },
      });
    }
    if (finalStage === 'CANCELLED') {
      t = at(t, 25);
      times.CANCELLED = t;
      steps.push({
        type: 'STAGE_CHANGED',
        at: t,
        actorId: assigner,
        fromStage: FLOW[reached],
        toStage: 'CANCELLED',
        note: CANCEL_REASONS[i % CANCEL_REASONS.length],
        data: { action: 'cancel' },
      });
    }
    // Nothing may happen in the future.
    const latest = Math.max(...steps.map((s) => s.at.getTime()));
    const shift = Math.max(0, latest - at(now, -5).getTime());
    for (const step of steps) step.at = new Date(step.at.getTime() - shift);
    for (const key of Object.keys(times) as TicketStage[])
      times[key] = new Date(times[key]!.getTime() - shift);

    return {
      i,
      finalStage,
      machine,
      customer,
      site,
      title,
      serviceTypeId: serviceType.id,
      priority,
      channel,
      region,
      engineerId: reached >= FLOW.indexOf('ASSIGNED') ? engineerId : null,
      creator,
      steps,
      times,
      createdAt: steps[0].at,
    };
  }
}
