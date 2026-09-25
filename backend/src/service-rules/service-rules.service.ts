import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type BillingRate, Prisma, type TicketPriority, type TicketStage } from '@prisma/client';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { AuditService, diffFields } from '../core/audit/audit.service';
import { AppException, validationFailed } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { AppSettingsService } from '../demo/app-settings.service';
import { addBusinessMinutes, type CalendarRules, calendarProblems } from './business-calendar';
import { assertVersion, notFound, rethrowUnique } from './common';
import {
  BILLING_RATES,
  BUSINESS_HOURS,
  CALENDAR_24X7,
  CALENDAR_BUSINESS,
  PRIORITIES,
  SERVICE_TYPES,
  SLA_DEFAULTS,
  STAGES,
} from './defaults';
import type {
  BillingRateDto,
  CalendarDto,
  CreateServiceTypeDto,
  PriceListsDto,
  UpdateBillingRateDto,
  UpdateCalendarDto,
  UpdateLabelDto,
  UpdateServiceTypeDto,
  UpdateSlaPolicyDto,
} from './dto';

export const BILLING_KEY = 'billing';

export interface BillingSettings {
  /** ERP price list for spares on chargeable tickets. */
  sparesPriceList: string | null;
  /** Price list for spares on machines under AMC. */
  amcPriceList: string | null;
}

const toRate = (rate: BillingRate) => ({ ...rate, amount: Number(rate.amount) });

const calendarRules = (row: {
  alwaysOpen: boolean;
  hours: unknown;
  holidays: unknown;
}): CalendarRules => ({
  alwaysOpen: row.alwaysOpen,
  hours: (row.hours as CalendarRules['hours']) ?? [],
  holidays: (row.holidays as CalendarRules['holidays']) ?? [],
});

type Actor = { actor: AuthUser; client: ClientInfo };

/** SLA policies and calendars, service types, priorities, stage labels and billing. */
@Injectable()
export class ServiceRulesService implements OnModuleInit {
  private readonly logger = new Logger(ServiceRulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: AppSettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDefaults();
    } catch (error) {
      // The API still starts (e.g. before the migration is applied); the screens will show the error.
      this.logger.error(`Could not create default service rules: ${(error as Error).message}`);
    }
  }

  /** Creates the default rules where none exist. Safe to run on every start and from several instances. */
  async ensureDefaults(): Promise<void> {
    const db = this.prisma;
    await db.priorityLevel.createMany({ data: PRIORITIES, skipDuplicates: true });
    await db.stageLabel.createMany({ data: STAGES, skipDuplicates: true });
    if ((await db.businessCalendar.count()) === 0) {
      await db.businessCalendar.createMany({
        data: [
          { name: CALENDAR_24X7, alwaysOpen: true },
          {
            name: CALENDAR_BUSINESS,
            alwaysOpen: false,
            hours: BUSINESS_HOURS as unknown as Prisma.InputJsonValue,
          },
        ],
        skipDuplicates: true,
      });
    }
    if ((await db.slaPolicy.count()) < SLA_DEFAULTS.length) {
      const calendars = await db.businessCalendar.findMany({ select: { id: true, name: true } });
      const byName = new Map(calendars.map((c) => [c.name, c.id]));
      const fallback = calendars[0]?.id;
      if (fallback) {
        await db.slaPolicy.createMany({
          data: SLA_DEFAULTS.map(
            ([coverage, priority, responseMinutes, resolutionMinutes, calendar]) => ({
              coverage,
              priority,
              responseMinutes,
              resolutionMinutes,
              calendarId: byName.get(calendar) ?? fallback,
            }),
          ),
          skipDuplicates: true,
        });
      }
    }
    if ((await db.serviceType.count()) === 0) {
      await db.serviceType.createMany({
        data: SERVICE_TYPES.map((t, i) => ({ ...t, sortOrder: i })),
        skipDuplicates: true,
      });
    }
    if ((await db.billingRate.count()) === 0) {
      await db.billingRate.createMany({ data: BILLING_RATES, skipDuplicates: true });
    }
  }

  private record(
    tx: Prisma.TransactionClient,
    { actor, client }: Actor,
    action: string,
    entityType: string,
    entityId: string,
    summary: string,
    changes?: Record<string, { from: unknown; to: unknown }>,
  ) {
    return this.audit.record(
      {
        actorId: actor.id,
        action,
        entityType,
        entityId,
        summary: `${actor.name} ${summary}`,
        changes,
        ip: client.ip,
        requestId: client.requestId,
      },
      tx,
    );
  }

  // ─── Priorities & stage labels ───────────────────────────────────────────

  priorities() {
    return this.prisma.priorityLevel
      .findMany()
      .then((rows) =>
        PRIORITIES.map((d) => rows.find((r) => r.priority === d.priority)).filter(Boolean),
      );
  }

  stages() {
    return this.prisma.stageLabel
      .findMany()
      .then((rows) => STAGES.map((d) => rows.find((r) => r.stage === d.stage)).filter(Boolean));
  }

  async updatePriority(priority: TicketPriority, dto: UpdateLabelDto, who: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.priorityLevel.findUnique({ where: { priority } });
      if (!row) throw notFound('PRIORITY_NOT_FOUND', 'priority');
      assertVersion(row.version, dto.version, 'priority');
      const data = { label: dto.label.trim(), description: dto.description?.trim() || null };
      const changes = diffFields({ label: row.label, description: row.description }, data);
      const updated = await tx.priorityLevel.update({
        where: { priority },
        data: { ...data, version: { increment: 1 } },
      });
      if (Object.keys(changes).length) {
        await this.record(
          tx,
          who,
          'rules.priority_updated',
          'priority',
          priority,
          `renamed priority ${priority}`,
          changes,
        );
      }
      return updated;
    });
  }

  async updateStage(stage: TicketStage, dto: UpdateLabelDto, who: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.stageLabel.findUnique({ where: { stage } });
      if (!row) throw notFound('STAGE_NOT_FOUND', 'stage');
      assertVersion(row.version, dto.version, 'stage label');
      const data = { label: dto.label.trim(), description: dto.description?.trim() || null };
      const changes = diffFields({ label: row.label, description: row.description }, data);
      const updated = await tx.stageLabel.update({
        where: { stage },
        data: { ...data, version: { increment: 1 } },
      });
      if (Object.keys(changes).length) {
        await this.record(
          tx,
          who,
          'rules.stage_updated',
          'stage',
          stage,
          `renamed stage ${stage}`,
          changes,
        );
      }
      return updated;
    });
  }

  // ─── Service types ───────────────────────────────────────────────────────

  serviceTypes() {
    return this.prisma.serviceType.findMany({
      orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createServiceType(dto: CreateServiceTypeDto, who: Actor) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const last = await tx.serviceType.aggregate({ _max: { sortOrder: true } });
        const row = await tx.serviceType.create({
          data: {
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            defaultPriority: dto.defaultPriority,
            requiresEquipment: dto.requiresEquipment,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
          },
        });
        await this.record(
          tx,
          who,
          'rules.service_type_created',
          'service_type',
          row.id,
          `added service type ${row.name}`,
        );
        return row;
      });
    } catch (error) {
      rethrowUnique(
        error,
        'SERVICE_TYPE_EXISTS',
        'name',
        'A service type with that name already exists.',
      );
    }
  }

  async updateServiceType(id: string, dto: UpdateServiceTypeDto, who: Actor) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.serviceType.findUnique({ where: { id } });
        if (!row) throw notFound('SERVICE_TYPE_NOT_FOUND', 'service type');
        assertVersion(row.version, dto.version, 'service type');
        if (dto.active === false && row.active) {
          const othersActive = await tx.serviceType.count({
            where: { active: true, id: { not: id } },
          });
          if (!othersActive) {
            throw new AppException(
              'LAST_SERVICE_TYPE',
              'Keep at least one service type active, or tickets cannot be logged.',
              HttpStatus.CONFLICT,
            );
          }
        }
        const data = {
          name: dto.name?.trim(),
          description: dto.description === undefined ? undefined : dto.description.trim() || null,
          defaultPriority: dto.defaultPriority,
          requiresEquipment: dto.requiresEquipment,
          active: dto.active,
          sortOrder: dto.sortOrder,
        };
        const changes = diffFields(row, data);
        const updated = await tx.serviceType.update({
          where: { id },
          data: { ...data, version: { increment: 1 } },
        });
        if (Object.keys(changes).length) {
          await this.record(
            tx,
            who,
            'rules.service_type_updated',
            'service_type',
            id,
            `updated service type ${updated.name}`,
            changes,
          );
        }
        return updated;
      });
    } catch (error) {
      rethrowUnique(
        error,
        'SERVICE_TYPE_EXISTS',
        'name',
        'A service type with that name already exists.',
      );
    }
  }

  // ─── Calendars & SLA ─────────────────────────────────────────────────────

  async sla() {
    const [policies, calendars, company] = await Promise.all([
      this.prisma.slaPolicy.findMany({
        select: {
          id: true,
          coverage: true,
          priority: true,
          responseMinutes: true,
          resolutionMinutes: true,
          calendarId: true,
          version: true,
        },
      }),
      this.prisma.businessCalendar.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { policies: true } } },
      }),
      this.settings.company(),
    ]);
    // Due times for a ticket logged right now, so admins can sanity-check the numbers.
    const now = new Date();
    const rulesById = new Map(calendars.map((c) => [c.id, calendarRules(c)]));
    return {
      timezone: company.timezone,
      now,
      policies: policies.map((p) => {
        const rules = rulesById.get(p.calendarId) ?? { alwaysOpen: true, hours: [], holidays: [] };
        return {
          ...p,
          responseDueAt: addBusinessMinutes(now, p.responseMinutes, rules, company.timezone),
          resolutionDueAt: addBusinessMinutes(now, p.resolutionMinutes, rules, company.timezone),
        };
      }),
      calendars: calendars.map(({ _count, ...c }) => ({
        ...c,
        ...calendarRules(c),
        policyCount: _count.policies,
      })),
    };
  }

  private checkCalendar(dto: CalendarDto) {
    const rules: CalendarRules = {
      alwaysOpen: dto.alwaysOpen,
      hours: dto.alwaysOpen ? [] : dto.hours,
      holidays: dto.holidays.map((h) => ({ date: h.date, name: h.name.trim() })),
    };
    const problems = calendarProblems(rules);
    if (problems.length) throw validationFailed(problems);
    rules.holidays.sort((a, b) => a.date.localeCompare(b.date));
    return rules;
  }

  async createCalendar(dto: CalendarDto, who: Actor) {
    const rules = this.checkCalendar(dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.businessCalendar.create({
          data: {
            name: dto.name.trim(),
            alwaysOpen: rules.alwaysOpen,
            hours: rules.hours as unknown as Prisma.InputJsonValue,
            holidays: rules.holidays as unknown as Prisma.InputJsonValue,
          },
        });
        await this.record(
          tx,
          who,
          'rules.calendar_created',
          'calendar',
          row.id,
          `added calendar ${row.name}`,
        );
        return row;
      });
    } catch (error) {
      rethrowUnique(error, 'CALENDAR_EXISTS', 'name', 'A calendar with that name already exists.');
    }
  }

  async updateCalendar(id: string, dto: UpdateCalendarDto, who: Actor) {
    const rules = this.checkCalendar(dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.businessCalendar.findUnique({ where: { id } });
        if (!row) throw notFound('CALENDAR_NOT_FOUND', 'calendar');
        assertVersion(row.version, dto.version, 'calendar');
        const updated = await tx.businessCalendar.update({
          where: { id },
          data: {
            name: dto.name.trim(),
            alwaysOpen: rules.alwaysOpen,
            hours: rules.hours as unknown as Prisma.InputJsonValue,
            holidays: rules.holidays as unknown as Prisma.InputJsonValue,
            version: { increment: 1 },
          },
        });
        const changes = diffFields(
          {
            name: row.name,
            alwaysOpen: row.alwaysOpen,
            hours: JSON.stringify(row.hours),
            holidays: JSON.stringify(row.holidays),
          },
          {
            name: updated.name,
            alwaysOpen: updated.alwaysOpen,
            hours: JSON.stringify(rules.hours),
            holidays: JSON.stringify(rules.holidays),
          },
        );
        if (Object.keys(changes).length) {
          await this.record(
            tx,
            who,
            'rules.calendar_updated',
            'calendar',
            id,
            `updated calendar ${updated.name}: ${Object.keys(changes).join(', ')}`,
          );
        }
        return updated;
      });
    } catch (error) {
      rethrowUnique(error, 'CALENDAR_EXISTS', 'name', 'A calendar with that name already exists.');
    }
  }

  async deleteCalendar(id: string, who: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.businessCalendar.findUnique({
        where: { id },
        include: { _count: { select: { policies: true } } },
      });
      if (!row) throw notFound('CALENDAR_NOT_FOUND', 'calendar');
      if (row._count.policies) {
        throw new AppException(
          'CALENDAR_IN_USE',
          `${row._count.policies} SLA ${row._count.policies === 1 ? 'policy uses' : 'policies use'} this calendar. Move them to another calendar first.`,
          HttpStatus.CONFLICT,
        );
      }
      await tx.businessCalendar.delete({ where: { id } });
      await this.record(
        tx,
        who,
        'rules.calendar_deleted',
        'calendar',
        id,
        `deleted calendar ${row.name}`,
      );
    });
  }

  async updateSlaPolicy(id: string, dto: UpdateSlaPolicyDto, who: Actor) {
    if (dto.resolutionMinutes < dto.responseMinutes) {
      throw validationFailed([
        { field: 'resolutionMinutes', message: 'Resolution cannot be sooner than response.' },
      ]);
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.slaPolicy.findUnique({ where: { id } });
      if (!row) throw notFound('SLA_POLICY_NOT_FOUND', 'SLA policy');
      assertVersion(row.version, dto.version, 'SLA policy');
      if (!(await tx.businessCalendar.findUnique({ where: { id: dto.calendarId } }))) {
        throw validationFailed([
          { field: 'calendarId', message: 'Choose a calendar from the list.' },
        ]);
      }
      const data = {
        responseMinutes: dto.responseMinutes,
        resolutionMinutes: dto.resolutionMinutes,
        calendarId: dto.calendarId,
      };
      const changes = diffFields(row, data);
      const updated = await tx.slaPolicy.update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
      });
      if (Object.keys(changes).length) {
        await this.record(
          tx,
          who,
          'rules.sla_updated',
          'sla_policy',
          id,
          `changed the ${row.coverage} × ${row.priority} SLA`,
          changes,
        );
      }
      return updated;
    });
  }

  // ─── Billing ─────────────────────────────────────────────────────────────

  async billingSettings(): Promise<BillingSettings> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: BILLING_KEY } });
    return {
      sparesPriceList: null,
      amcPriceList: null,
      ...((row?.value as Partial<BillingSettings>) ?? {}),
    };
  }

  async billing() {
    const [rates, settings, lists] = await Promise.all([
      this.prisma.billingRate.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
      this.billingSettings(),
      this.prisma.itemPrice.groupBy({
        by: ['priceList'],
        where: { active: true, selling: true },
        _count: { _all: true },
        orderBy: { priceList: 'asc' },
      }),
    ]);
    return {
      rates: rates.map(toRate),
      ...settings,
      priceLists: lists.map((l) => ({ name: l.priceList, itemCount: l._count._all })),
    };
  }

  async setPriceLists(dto: PriceListsDto, who: Actor): Promise<BillingSettings> {
    const next: BillingSettings = {
      sparesPriceList: dto.sparesPriceList?.trim() || null,
      amcPriceList: dto.amcPriceList?.trim() || null,
    };
    const known = new Set(
      (
        await this.prisma.itemPrice.findMany({
          distinct: ['priceList'],
          select: { priceList: true },
        })
      ).map((p) => p.priceList),
    );
    const problems = (['sparesPriceList', 'amcPriceList'] as const)
      .filter((field) => next[field] && !known.has(next[field]))
      .map((field) => ({ field, message: 'Choose a price list that has prices.' }));
    if (problems.length) throw validationFailed(problems);

    return this.prisma.$transaction(async (tx) => {
      const current = await this.billingSettings();
      await tx.appSetting.upsert({
        where: { key: BILLING_KEY },
        create: { key: BILLING_KEY, value: next as unknown as Prisma.InputJsonValue },
        update: { value: next as unknown as Prisma.InputJsonValue },
      });
      const changes = diffFields({ ...current }, { ...next });
      if (Object.keys(changes).length) {
        await this.record(
          tx,
          who,
          'rules.price_lists_updated',
          'app_setting',
          BILLING_KEY,
          'changed the price lists used for spares',
          changes,
        );
      }
      return next;
    });
  }

  async createBillingRate(dto: BillingRateDto, who: Actor) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.billingRate.create({
          data: {
            code: dto.code,
            name: dto.name.trim(),
            unit: dto.unit,
            amount: new Prisma.Decimal(dto.amount),
            erpItemCode: dto.erpItemCode?.trim() || null,
          },
        });
        await this.record(
          tx,
          who,
          'rules.billing_rate_created',
          'billing_rate',
          row.id,
          `added billing rate ${row.name}`,
        );
        return toRate(row);
      });
    } catch (error) {
      rethrowUnique(error, 'BILLING_CODE_EXISTS', 'code', 'Another rate already uses that code.');
    }
  }

  async updateBillingRate(id: string, dto: UpdateBillingRateDto, who: Actor) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.billingRate.findUnique({ where: { id } });
        if (!row) throw notFound('BILLING_RATE_NOT_FOUND', 'billing rate');
        assertVersion(row.version, dto.version, 'billing rate');
        const data = {
          code: dto.code,
          name: dto.name.trim(),
          unit: dto.unit,
          amount: dto.amount,
          erpItemCode: dto.erpItemCode === undefined ? undefined : dto.erpItemCode?.trim() || null,
          active: dto.active,
        };
        const changes = diffFields({ ...row, amount: Number(row.amount) }, data);
        const updated = await tx.billingRate.update({
          where: { id },
          data: { ...data, amount: new Prisma.Decimal(dto.amount), version: { increment: 1 } },
        });
        if (Object.keys(changes).length) {
          await this.record(
            tx,
            who,
            'rules.billing_rate_updated',
            'billing_rate',
            id,
            `updated billing rate ${updated.name}`,
            changes,
          );
        }
        return toRate(updated);
      });
    } catch (error) {
      rethrowUnique(error, 'BILLING_CODE_EXISTS', 'code', 'Another rate already uses that code.');
    }
  }
}
