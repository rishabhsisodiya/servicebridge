import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type Coverage,
  Prisma,
  type Ticket,
  type TicketPriority,
  type TicketStage,
} from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { hasPermission } from '../auth/permissions';
import { coverageOf } from '../catalog/coverage';
import { AppException, validationFailed } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { AppSettingsService } from '../demo/app-settings.service';
import { addBusinessMinutes, businessMinutesBetween } from '../service-rules/business-calendar';
import { assertVersion } from '../service-rules/common';
import { RegionsService } from '../service-rules/regions.service';
import { ServiceRulesService } from '../service-rules/service-rules.service';
import type {
  ActionDto,
  CreateTicketDto,
  ListTicketsQuery,
  QuickFilter,
  UpdateTicketDto,
} from './dto';
import { SlaTimersService } from './sla-timers.service';
import { slaFields, slaStatus } from './sla';
import { ACTIONS, availableActions, blockedReason, FINAL_STAGES, nextStage } from './workflow';

const NUMBER_PREFIX = 'SB';
/** Stages where an engineer is busy with the ticket (counts towards their load). */
const WORKLOAD_STAGES: TicketStage[] = [
  'ASSIGNED',
  'ACCEPTED',
  'ON_SITE',
  'IN_PROGRESS',
  'ON_HOLD',
];

const ticketNotFound = () =>
  new AppException(
    'TICKET_NOT_FOUND',
    "That ticket doesn't exist, or you can't see it.",
    HttpStatus.NOT_FOUND,
  );

const rowInclude = {
  customer: { select: { id: true, name: true } },
  site: { select: { id: true, title: true, city: true, pincode: true } },
  equipment: { select: { id: true, serialNo: true, itemCode: true, itemName: true } },
  engineer: { select: { id: true, name: true } },
  region: { select: { id: true, name: true } },
} satisfies Prisma.TicketInclude;

type RowTicket = Prisma.TicketGetPayload<{ include: typeof rowInclude }>;

export function toTicketRow(t: RowTicket, now = new Date()) {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    stage: t.stage,
    priority: t.priority,
    coverage: t.coverage,
    channel: t.channel,
    isDemo: t.isDemo,
    createdAt: t.createdAt,
    customer: t.customer,
    site: t.site,
    equipment: t.equipment,
    engineer: t.engineer,
    region: t.region,
    sla: slaStatus(t, now),
    version: t.version,
  };
}

/** Where a user may see tickets. Everyone else gets a 404, not a 403, so ticket numbers don't leak. */
export function visibleTo(
  user: Pick<AuthUser, 'id' | 'role' | 'regionId'>,
): Prisma.TicketWhereInput {
  if (hasPermission(user.role, 'tickets.viewAll')) return {};
  if (user.role === 'ENGINEER') return { engineerId: user.id };
  return {
    OR: [
      ...(user.regionId ? [{ regionId: user.regionId }] : []),
      { areaManagerId: user.id },
      { createdById: user.id },
      { engineerId: user.id },
    ],
  };
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: ServiceRulesService,
    private readonly regions: RegionsService,
    private readonly settings: AppSettingsService,
    private readonly timers: SlaTimersService,
  ) {}

  /** Labels and choices every ticket screen needs (any user who can see tickets). */
  async lookups() {
    const [serviceTypes, priorities, stages] = await Promise.all([
      this.prisma.serviceType.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          description: true,
          defaultPriority: true,
          requiresEquipment: true,
        },
      }),
      this.rules.priorities(),
      this.rules.stages(),
    ]);
    return {
      serviceTypes,
      priorities: priorities.map((p) => ({
        priority: p!.priority,
        label: p!.label,
        description: p!.description,
      })),
      stages: stages.map((s) => ({
        stage: s!.stage,
        label: s!.label,
        description: s!.description,
      })),
      actions: Object.fromEntries(
        Object.entries(ACTIONS).map(([key, rule]) => [key, { label: rule.label, note: rule.note }]),
      ),
    };
  }

  // ─── Lists ────────────────────────────────────────────────────────────────

  private quickWhere(quick: QuickFilter, user: AuthUser, now: Date): Prisma.TicketWhereInput {
    const open = { stage: { notIn: FINAL_STAGES } };
    switch (quick) {
      case 'open':
        return open;
      case 'mine':
        return {
          ...open,
          OR: [{ engineerId: user.id }, { areaManagerId: user.id }, { createdById: user.id }],
        };
      case 'sla-risk':
        return { slaRiskAt: { lte: now } };
      case 'unassigned':
        return { ...open, engineerId: null };
      case 'awaiting-verification':
        return { stage: { in: ['RESOLVED', 'VERIFIED'] } };
      case 'chargeable':
        return { ...open, coverage: 'CHARGEABLE' };
      case 'closed':
        return { stage: { in: FINAL_STAGES } };
      case 'all':
        return {};
    }
  }

  private searchWhere(search?: string): Prisma.TicketWhereInput {
    const words = (search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
    return {
      AND: words.map((word) => ({
        OR: [
          { number: { contains: word, mode: 'insensitive' } },
          { title: { contains: word, mode: 'insensitive' } },
          { customer: { name: { contains: word, mode: 'insensitive' } } },
          { equipment: { serialNo: { contains: word, mode: 'insensitive' } } },
          { engineer: { name: { contains: word, mode: 'insensitive' } } },
        ],
      })),
    };
  }

  async list(user: AuthUser, query: ListTicketsQuery) {
    const now = new Date();
    const base: Prisma.TicketWhereInput = {
      AND: [
        visibleTo(user),
        this.searchWhere(query.search),
        {
          priority: query.priority,
          stage: query.stage,
          customerId: query.customerId,
          equipmentId: query.equipmentId,
        },
      ],
    };
    const where = { AND: [base, this.quickWhere(query.quick, user, now)] };
    const orderBy: Prisma.TicketOrderByWithRelationInput[] = {
      newest: [{ createdAt: 'desc' as const }],
      oldest: [{ createdAt: 'asc' as const }],
      due: [
        { slaDueAt: { sort: 'asc' as const, nulls: 'last' as const } },
        { createdAt: 'desc' as const },
      ],
      priority: [
        { priority: 'asc' as const },
        { slaDueAt: { sort: 'asc' as const, nulls: 'last' as const } },
      ],
    }[query.sort];

    const quickKeys: QuickFilter[] = [
      'open',
      'mine',
      'sla-risk',
      'unassigned',
      'awaiting-verification',
      'chargeable',
      'closed',
    ];
    const [total, tickets, ...counts] = await this.prisma.$transaction([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        include: rowInclude,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      ...quickKeys.map((key) =>
        this.prisma.ticket.count({ where: { AND: [base, this.quickWhere(key, user, now)] } }),
      ),
    ]);
    return {
      data: tickets.map((t) => toTicketRow(t, now)),
      meta: { page: query.page, pageSize: query.pageSize, total },
      counts: Object.fromEntries(quickKeys.map((key, i) => [key, counts[i]])),
    };
  }

  /** Open tickets already logged against a machine (a warning, never a block). */
  async duplicates(user: AuthUser, equipmentId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { AND: [visibleTo(user), { equipmentId, stage: { notIn: FINAL_STAGES } }] },
      include: rowInclude,
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return tickets.map((t) => toTicketRow(t));
  }

  // ─── One ticket ───────────────────────────────────────────────────────────

  /** By id or ticket number, only if the user may see it. */
  private async findVisible(
    user: AuthUser,
    idOrNumber: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const ticket = await db.ticket.findFirst({
      where: { AND: [visibleTo(user), { OR: [{ id: idOrNumber }, { number: idOrNumber }] }] },
    });
    if (!ticket) throw ticketNotFound();
    return ticket;
  }

  async detail(user: AuthUser, idOrNumber: string) {
    const { id } = await this.findVisible(user, idOrNumber);
    const now = new Date();
    const t = await this.prisma.ticket.findUniqueOrThrow({
      where: { id },
      include: {
        ...rowInclude,
        customer: { select: { id: true, name: true, mobile: true, email: true, territory: true } },
        site: {
          select: { id: true, title: true, line1: true, city: true, state: true, pincode: true },
        },
        equipment: {
          select: {
            id: true,
            serialNo: true,
            itemCode: true,
            itemName: true,
            warrantyExpiresOn: true,
            amcExpiresOn: true,
          },
        },
        contact: { select: { id: true, fullName: true, mobile: true, phone: true, email: true } },
        serviceType: { select: { id: true, name: true } },
        areaManager: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        duplicateOf: { select: { id: true, number: true } },
        events: {
          orderBy: { createdAt: 'asc' },
          include: { actor: { select: { id: true, name: true } } },
        },
        attachments: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
            uploadedBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    const [openForCustomer, openForMachine] = await Promise.all([
      this.prisma.ticket.count({
        where: { customerId: t.customerId, stage: { notIn: FINAL_STAGES } },
      }),
      t.equipmentId
        ? this.prisma.ticket.count({
            where: {
              equipmentId: t.equipmentId,
              stage: { notIn: FINAL_STAGES },
              id: { not: t.id },
            },
          })
        : 0,
    ]);
    const { events, attachments, ...rest } = t;
    return {
      ...toTicketRow(t, now),
      description: rest.description,
      contact: rest.contact,
      serviceType: rest.serviceType,
      areaManager: rest.areaManager,
      createdBy: rest.createdBy,
      duplicateOf: rest.duplicateOf,
      coverageUntil: rest.coverageUntil,
      holdReason: rest.holdReason,
      stageBeforeHold: rest.stageBeforeHold,
      reopenCount: rest.reopenCount,
      targets: { responseMinutes: rest.responseMinutes, resolutionMinutes: rest.resolutionMinutes },
      dates: {
        responseDueAt: rest.responseDueAt,
        resolutionDueAt: rest.resolutionDueAt,
        respondedAt: rest.respondedAt,
        resolvedAt: rest.resolvedAt,
        verifiedAt: rest.verifiedAt,
        closedAt: rest.closedAt,
        cancelledAt: rest.cancelledAt,
        pausedAt: rest.pausedAt,
      },
      breached: { response: rest.responseBreached, resolution: rest.resolutionBreached },
      openForCustomer,
      openForMachine,
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        actor: e.actor,
        fromStage: e.fromStage,
        toStage: e.toStage,
        note: e.note,
        data: e.data,
        createdAt: e.createdAt,
      })),
      attachments,
      actions: availableActions(t, user, now),
    };
  }

  // ─── Logging a ticket ─────────────────────────────────────────────────────

  async nextNumber(tx: Prisma.TransactionClient, now: Date): Promise<string> {
    const { timezone } = await this.settings.company();
    const year = Number(
      new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric' }).format(now),
    );
    const counter = await tx.ticketCounter.upsert({
      where: { year },
      create: { year, last: 1 },
      update: { last: { increment: 1 } },
    });
    return `${NUMBER_PREFIX}-${String(year % 100).padStart(2, '0')}-${String(counter.last).padStart(6, '0')}`;
  }

  async create(user: AuthUser, dto: CreateTicketDto) {
    const now = new Date();
    const ticket = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: dto.customerId },
        include: { sites: { where: { active: true }, select: { id: true } } },
      });
      if (!customer)
        throw validationFailed([
          { field: 'customerId', message: 'Choose a customer from the list.' },
        ]);

      const siteId = dto.siteId ?? (customer.sites.length === 1 ? customer.sites[0].id : undefined);
      const [site, equipment, contact, serviceType] = await Promise.all([
        siteId ? tx.site.findUnique({ where: { id: siteId } }) : null,
        dto.equipmentId ? tx.equipment.findUnique({ where: { id: dto.equipmentId } }) : null,
        dto.contactId ? tx.customerContact.findUnique({ where: { id: dto.contactId } }) : null,
        tx.serviceType.findUnique({ where: { id: dto.serviceTypeId } }),
      ]);
      const problems = [
        siteId &&
          site?.customerId !== customer.id && {
            field: 'siteId',
            message: "Choose one of this customer's sites.",
          },
        dto.equipmentId &&
          equipment?.customerId !== customer.id && {
            field: 'equipmentId',
            message: "Choose one of this customer's machines.",
          },
        dto.contactId &&
          contact?.customerId !== customer.id && {
            field: 'contactId',
            message: "Choose one of this customer's contacts.",
          },
        (!serviceType || !serviceType.active) && {
          field: 'serviceTypeId',
          message: 'Choose a service type.',
        },
        serviceType?.requiresEquipment &&
          !dto.equipmentId && {
            field: 'equipmentId',
            message: `Choose the machine. ${serviceType.name} tickets need one.`,
          },
      ].filter((p): p is { field: string; message: string } => !!p);
      if (problems.length) throw validationFailed(problems);

      if (equipment && !dto.acknowledgeDuplicates) {
        const open = await tx.ticket.findMany({
          where: { equipmentId: equipment.id, stage: { notIn: FINAL_STAGES } },
          select: { number: true },
          take: 3,
        });
        if (open.length) {
          throw new AppException(
            'DUPLICATE_SUSPECTED',
            `This machine already has an open ticket (${open.map((o) => o.number).join(', ')}). Log anyway only if it's a different problem.`,
            HttpStatus.CONFLICT,
          );
        }
      }

      const priority = dto.priority ?? serviceType!.defaultPriority;
      const cover = equipment
        ? coverageOf(equipment, now)
        : { coverage: 'CHARGEABLE' as Coverage, until: null };
      const sla = await this.rules.slaFor(cover.coverage, priority, now, tx);
      const region = await this.regions.forPincode(site?.pincode, tx);
      const number = await this.nextNumber(tx, now);
      const base = {
        stage: 'NEW' as TicketStage,
        respondedAt: null,
        resolvedAt: null,
        ...sla,
      };

      const created = await tx.ticket.create({
        data: {
          number,
          title: dto.title,
          description: dto.description?.trim() || null,
          customerId: customer.id,
          siteId: site?.id ?? null,
          equipmentId: equipment?.id ?? null,
          contactId: contact?.id ?? null,
          serviceTypeId: serviceType!.id,
          priority,
          channel: dto.channel,
          coverage: cover.coverage,
          coverageUntil: cover.until,
          regionId: region?.id ?? null,
          areaManagerId: region?.areaManagerId ?? null,
          createdById: user.id,
          isDemo: customer.source === 'DEMO',
          ...sla,
          ...slaFields(base),
          events: {
            create: [
              { type: 'CREATED', actorId: user.id, toStage: 'NEW', data: { channel: dto.channel } },
              {
                type: 'ROUTED',
                data: region
                  ? {
                      regionId: region.id,
                      regionName: region.name,
                      areaManagerId: region.areaManagerId,
                    }
                  : { regionId: null, pincode: site?.pincode ?? null },
                createdAt: new Date(now.getTime() + 1),
              },
            ],
          },
        },
      });
      return created;
    });
    await this.timers.sync(ticket);
    return { id: ticket.id, number: ticket.number };
  }

  // ─── Changing a ticket ────────────────────────────────────────────────────

  async act(user: AuthUser, idOrNumber: string, dto: ActionDto) {
    const now = new Date();
    const note = dto.note?.trim() || null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await this.findVisible(user, idOrNumber, tx);
      assertVersion(t.version, dto.version, 'ticket');
      const blocked = blockedReason(dto.action, t, user, now);
      if (blocked) throw new AppException('ACTION_NOT_ALLOWED', blocked, HttpStatus.CONFLICT);
      if (ACTIONS[dto.action].note === 'required' && !note) {
        throw validationFailed([{ field: 'note', message: 'Add a short reason.' }]);
      }

      const to = nextStage(dto.action, t);
      const changes: Prisma.TicketUncheckedUpdateInput = { stage: to };
      let eventType: 'STAGE_CHANGED' | 'ASSIGNED' | 'REOPENED' = 'STAGE_CHANGED';
      let eventData: Prisma.InputJsonValue = { action: dto.action };

      switch (dto.action) {
        case 'assign': {
          const engineer = dto.engineerId
            ? await tx.user.findUnique({ where: { id: dto.engineerId } })
            : null;
          if (!engineer || engineer.role !== 'ENGINEER' || engineer.status !== 'ACTIVE') {
            throw validationFailed([
              { field: 'engineerId', message: 'Choose an active engineer.' },
            ]);
          }
          if (engineer.id === t.engineerId && t.stage === 'ASSIGNED') {
            throw validationFailed([
              { field: 'engineerId', message: `${engineer.name} is already assigned.` },
            ]);
          }
          changes.engineerId = engineer.id;
          eventType = 'ASSIGNED';
          eventData = {
            action: 'assign',
            engineerId: engineer.id,
            engineerName: engineer.name,
            previousEngineerId: t.engineerId,
          };
          break;
        }
        case 'accept':
          changes.respondedAt = t.respondedAt ?? now;
          if (!t.respondedAt) changes.responseBreached = now > t.responseDueAt;
          break;
        case 'decline':
          changes.engineerId = null;
          break;
        case 'hold': {
          const { rules, timeZone } = await this.rules.clock(t.slaCalendarId, tx);
          changes.stageBeforeHold = t.stage;
          changes.holdReason = note;
          changes.pausedAt = now;
          changes.responseLeftMin = t.respondedAt
            ? null
            : businessMinutesBetween(now, t.responseDueAt, rules, timeZone);
          changes.resolutionLeftMin = businessMinutesBetween(
            now,
            t.resolutionDueAt,
            rules,
            timeZone,
          );
          break;
        }
        case 'resume': {
          const { rules, timeZone } = await this.rules.clock(t.slaCalendarId, tx);
          // A clock with time left restarts from now; one already overdue stays overdue.
          if (t.responseLeftMin)
            changes.responseDueAt = addBusinessMinutes(now, t.responseLeftMin, rules, timeZone);
          if (t.resolutionLeftMin)
            changes.resolutionDueAt = addBusinessMinutes(now, t.resolutionLeftMin, rules, timeZone);
          Object.assign(changes, {
            stageBeforeHold: null,
            holdReason: null,
            pausedAt: null,
            responseLeftMin: null,
            resolutionLeftMin: null,
          });
          eventData = {
            action: 'resume',
            pausedMinutes: t.pausedAt
              ? Math.round((now.getTime() - t.pausedAt.getTime()) / 60_000)
              : 0,
          };
          break;
        }
        case 'resolve':
          changes.resolvedAt = now;
          changes.resolutionBreached = now > t.resolutionDueAt;
          break;
        case 'verify':
          changes.verifiedAt = now;
          break;
        case 'reject':
          changes.resolvedAt = null;
          changes.verifiedAt = null;
          break;
        case 'close':
          changes.closedAt = now;
          break;
        case 'cancel':
          changes.cancelledAt = now;
          break;
        case 'reopen': {
          const { rules, timeZone } = await this.rules.clock(t.slaCalendarId, tx);
          Object.assign(changes, {
            resolvedAt: null,
            verifiedAt: null,
            closedAt: null,
            reopenCount: { increment: 1 },
            resolutionDueAt: addBusinessMinutes(now, t.resolutionMinutes, rules, timeZone),
            resolutionBreached: false,
          });
          eventType = 'REOPENED';
          break;
        }
        case 'triage':
        case 'arrive':
        case 'start':
          break;
      }

      const merged = { ...t, ...changes } as Ticket;
      const row = await tx.ticket.update({
        where: { id: t.id },
        data: { ...changes, ...slaFields(merged), version: { increment: 1 } },
      });
      await tx.ticketEvent.create({
        data: {
          ticketId: t.id,
          type: eventType,
          actorId: user.id,
          fromStage: t.stage,
          toStage: to,
          note,
          data: eventData,
        },
      });
      return row;
    });
    await this.timers.sync(updated);
    return this.detail(user, updated.id);
  }

  async update(user: AuthUser, idOrNumber: string, dto: UpdateTicketDto) {
    if (
      !hasPermission(user.role, 'tickets.assign') &&
      !hasPermission(user.role, 'tickets.create')
    ) {
      throw new AppException(
        'FORBIDDEN',
        "You don't have permission to edit tickets.",
        HttpStatus.FORBIDDEN,
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await this.findVisible(user, idOrNumber, tx);
      assertVersion(t.version, dto.version, 'ticket');
      if (FINAL_STAGES.includes(t.stage)) {
        throw new AppException(
          'TICKET_FINISHED',
          'Closed or cancelled tickets can’t be edited.',
          HttpStatus.CONFLICT,
        );
      }
      const changes: Prisma.TicketUncheckedUpdateInput = {};
      if (dto.title !== undefined) changes.title = dto.title;
      if (dto.description !== undefined) changes.description = dto.description.trim() || null;

      if (dto.priority && dto.priority !== t.priority) {
        if (!hasPermission(user.role, 'tickets.assign')) {
          throw new AppException(
            'FORBIDDEN',
            'Only managers can change the priority.',
            HttpStatus.FORBIDDEN,
          );
        }
        if (t.stage === 'ON_HOLD' || t.resolvedAt) {
          throw new AppException(
            'PRIORITY_LOCKED',
            t.resolvedAt
              ? 'The ticket is already resolved.'
              : 'Resume the ticket before changing its priority.',
            HttpStatus.CONFLICT,
          );
        }
        // New targets, counted from when the ticket was logged.
        const sla = await this.rules.slaFor(t.coverage, dto.priority, t.createdAt, tx);
        Object.assign(changes, { priority: dto.priority, ...sla });
        await tx.ticketEvent.create({
          data: {
            ticketId: t.id,
            type: 'PRIORITY_CHANGED',
            actorId: user.id,
            data: { from: t.priority, to: dto.priority } satisfies Record<string, TicketPriority>,
          },
        });
      }
      const merged = { ...t, ...changes } as Ticket;
      return tx.ticket.update({
        where: { id: t.id },
        data: { ...changes, ...slaFields(merged), version: { increment: 1 } },
      });
    });
    await this.timers.sync(updated);
    return this.detail(user, updated.id);
  }

  async addNote(user: AuthUser, idOrNumber: string, note: string) {
    const t = await this.findVisible(user, idOrNumber);
    await this.prisma.ticketEvent.create({
      data: { ticketId: t.id, type: 'NOTE', actorId: user.id, note },
    });
    return this.detail(user, t.id);
  }

  /** Engineers ranked by skill match, then same region, then fewest open jobs. Suggest-only. */
  async suggestions(user: AuthUser, idOrNumber: string) {
    const t = await this.findVisible(user, idOrNumber);
    const equipment = t.equipmentId
      ? await this.prisma.equipment.findUnique({
          where: { id: t.equipmentId },
          select: { itemCode: true },
        })
      : null;
    const [engineers, loads] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'ENGINEER', status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          regionId: true,
          region: { select: { name: true } },
          skills: { select: { skillTag: { select: { name: true, equipmentModels: true } } } },
        },
      }),
      this.prisma.ticket.groupBy({
        by: ['engineerId'],
        where: { engineerId: { not: null }, stage: { in: WORKLOAD_STAGES } },
        _count: { _all: true },
      }),
    ]);
    const load = new Map(loads.map((l) => [l.engineerId, l._count._all]));
    return engineers
      .map((e) => {
        const matched = equipment?.itemCode
          ? e.skills
              .filter((s) => s.skillTag.equipmentModels.includes(equipment.itemCode!))
              .map((s) => s.skillTag.name)
          : [];
        return {
          id: e.id,
          name: e.name,
          region: e.region?.name ?? null,
          sameRegion: !!t.regionId && e.regionId === t.regionId,
          skills: matched,
          openTickets: load.get(e.id) ?? 0,
          current: e.id === t.engineerId,
        };
      })
      .sort(
        (a, b) =>
          Number(b.skills.length > 0) - Number(a.skills.length > 0) ||
          Number(b.sameRegion) - Number(a.sameRegion) ||
          a.openTickets - b.openTickets ||
          a.name.localeCompare(b.name),
      );
  }

  /** Used by attachments and timers: the ticket id if the user can see it. */
  async visibleId(user: AuthUser, idOrNumber: string): Promise<string> {
    return (await this.findVisible(user, idOrNumber)).id;
  }

  timersFor = (id: string) => this.timers.scheduled(id);
}
