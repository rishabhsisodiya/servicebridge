import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { ReadStream } from 'node:fs';
import type { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { cronProblem } from '../automations/automations.service';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { AuditService } from '../core/audit/audit.service';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { QueueService } from '../core/queue/queue.service';
import { StorageService } from '../core/storage/storage.service';
import { AppSettingsService } from '../demo/app-settings.service';
import { EmailService } from '../notifications/email.service';
import {
  REPORT_KEYS,
  ROW_CAP,
  describeCatalog,
  reportDefinition,
  validateReportParams,
  type ReportDefinition,
  type ReportKey,
  type ReportParams,
} from './catalog';
import { CSV_BOM, toCsv } from './csv';
import { KpiService, type KpiTargets } from './kpi.service';

/** Job name on the `reports` queue; one repeatable job per active schedule. */
export const RUN_REPORT_JOB = 'run-report';

/** BullMQ fixed id per schedule: repeats never duplicate, renames are clean. */
export const scheduleJobId = (scheduleId: string) => `report-schedule-${scheduleId}`;

/** Email attachments above this are skipped; the run history keeps the download. */
export const MAX_EMAIL_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const MIN_INTERVAL_MINUTES = 15;

export interface CreateScheduleInput {
  name: string;
  reportKey: string;
  params?: ReportParams;
  cron: string;
  timezone?: string;
  recipients: string[];
}

export interface UpdateScheduleInput {
  name?: string;
  reportKey?: string;
  params?: ReportParams;
  cron?: string;
  timezone?: string;
  recipients?: string[];
  version: number;
}

function timezoneValid(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function fail(code: string, message: string, status = HttpStatus.BAD_REQUEST): never {
  throw new AppException(code, message, status);
}

@Injectable()
export class ReportsService implements OnModuleInit {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly settings: AppSettingsService,
    private readonly email: EmailService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly kpi: KpiService,
  ) {}

  onModuleInit(): void {
    this.queues.register('reports', RUN_REPORT_JOB, (job: Job<{ scheduleId: string }>) =>
      this.executeScheduled(job),
    );
    void this.reconcile().catch((error: Error) =>
      this.logger.error(`Could not reconcile report schedules: ${error.message}`),
    );
  }

  // ── Catalog & on-demand runs ──────────────────────────────────────────────

  catalog() {
    return describeCatalog(this.prisma);
  }

  private definition(key: string): ReportDefinition {
    const def = reportDefinition(key);
    if (!def) fail('REPORT_UNKNOWN', `Unknown report "${key}".`, HttpStatus.NOT_FOUND);
    return def;
  }

  /** Runs a report right now, synchronously, capped at ROW_CAP rows. */
  async runOnDemand(
    user: Pick<AuthUser, 'id' | 'ticketScope' | 'regionId'>,
    key: string,
    params: ReportParams,
  ) {
    const def = this.definition(key);
    const problem = validateReportParams(def, params);
    if (problem) fail('REPORT_BAD_PARAMS', problem, HttpStatus.UNPROCESSABLE_ENTITY);
    const result = await def.run({ prisma: this.prisma, settings: this.settings, user, params });
    return { reportKey: def.key, label: def.label, ...result };
  }

  // ── Schedules ─────────────────────────────────────────────────────────────

  /**
   * Who may change a schedule: its owner, or an administrator (isAdmin = holds
   * the locked Administrator role). Reading a run additionally allows the
   * schedule's recipients; run output is rendered under the owner's scope.
   */
  private canManageSchedule(
    actor: Pick<AuthUser, 'id' | 'isAdmin'>,
    schedule: { createdById: string | null },
  ): boolean {
    return actor.isAdmin || (!!schedule.createdById && schedule.createdById === actor.id);
  }

  private canReadSchedule(
    actor: Pick<AuthUser, 'id' | 'isAdmin'>,
    schedule: { createdById: string | null; recipients: unknown },
  ): boolean {
    if (this.canManageSchedule(actor, schedule)) return true;
    return Array.isArray(schedule.recipients) && schedule.recipients.includes(actor.id);
  }

  private assertCanManageSchedule(
    actor: Pick<AuthUser, 'id' | 'isAdmin'>,
    schedule: { createdById: string | null },
  ): void {
    if (!this.canManageSchedule(actor, schedule)) {
      fail(
        'SCHEDULE_FORBIDDEN',
        'You can only change schedules you created.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /** Non-admins see only their own schedules; version + createdBy stay private. */
  listSchedules(actor: Pick<AuthUser, 'id' | 'isAdmin'>) {
    return this.prisma.reportSchedule.findMany({
      where: actor.isAdmin ? undefined : { createdById: actor.id },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { runs: true } },
      },
    });
  }

  /** The raw row, without any ownership check — for internal use only. */
  private async scheduleRow(id: string) {
    const schedule = await this.prisma.reportSchedule.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!schedule) fail('SCHEDULE_NOT_FOUND', 'Report schedule not found.', HttpStatus.NOT_FOUND);
    return schedule;
  }

  /** A schedule is visible to its owner and administrators (404, not 403). */
  async getSchedule(actor: Pick<AuthUser, 'id' | 'isAdmin'>, id: string) {
    const schedule = await this.scheduleRow(id);
    if (!this.canManageSchedule(actor, schedule)) {
      fail('SCHEDULE_NOT_FOUND', 'Report schedule not found.', HttpStatus.NOT_FOUND);
    }
    return schedule;
  }

  private async validateScheduleInput(input: CreateScheduleInput): Promise<{
    def: ReportDefinition;
    recipients: { id: string; email: string; name: string }[];
  }> {
    const def = this.definition(input.reportKey);
    const problem = validateReportParams(def, input.params ?? {});
    if (problem) fail('REPORT_BAD_PARAMS', problem, HttpStatus.UNPROCESSABLE_ENTITY);
    const cronProblemText = cronProblem(input.cron, input.timezone ?? 'Asia/Kolkata', MIN_INTERVAL_MINUTES);
    if (cronProblemText) fail('SCHEDULE_BAD_CRON', cronProblemText, HttpStatus.UNPROCESSABLE_ENTITY);
    if (input.timezone && !timezoneValid(input.timezone)) {
      fail('SCHEDULE_BAD_TIMEZONE', 'Unknown timezone.');
    }
    if (!input.recipients.length) fail('SCHEDULE_NO_RECIPIENTS', 'Pick at least one recipient.');
    const recipients = await this.prisma.user.findMany({
      where: { id: { in: input.recipients }, status: 'ACTIVE' },
      select: { id: true, email: true, name: true },
    });
    if (recipients.length !== input.recipients.length) {
      fail('SCHEDULE_BAD_RECIPIENTS', 'Every recipient must be an active user.');
    }
    return { def, recipients };
  }

  async createSchedule(actor: AuthUser, input: CreateScheduleInput, client: ClientInfo) {
    const { def } = await this.validateScheduleInput(input);
    const schedule = await this.prisma.$transaction(async (tx) => {
      const created = await tx.reportSchedule.create({
        data: {
          name: input.name.trim(),
          reportKey: def.key,
          params: (input.params ?? {}) as Prisma.InputJsonValue,
          cron: input.cron.trim(),
          timezone: input.timezone ?? 'Asia/Kolkata',
          recipients: input.recipients,
          createdById: actor.id,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'reports.schedule_created',
          entityType: 'ReportSchedule',
          entityId: created.id,
          summary: `${actor.name} created the scheduled report "${created.name}".`,
          ip: client.ip,
        },
        tx,
      );
      return created;
    });
    return schedule;
  }

  async updateSchedule(actor: AuthUser, id: string, input: UpdateScheduleInput, client: ClientInfo) {
    const existing = await this.scheduleRow(id);
    this.assertCanManageSchedule(actor, existing);
    const merged: CreateScheduleInput = {
      name: input.name ?? existing.name,
      reportKey: input.reportKey ?? existing.reportKey,
      params: input.params ?? (existing.params as ReportParams),
      cron: input.cron ?? existing.cron,
      timezone: input.timezone ?? existing.timezone,
      recipients: input.recipients ?? (existing.recipients as string[]),
    };
    const { def } = await this.validateScheduleInput(merged);
    if (existing.version !== input.version) {
      fail('VERSION_CONFLICT', 'This schedule changed while you were editing it.', HttpStatus.CONFLICT);
    }
    const wasActive = existing.active;
    const schedule = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.reportSchedule.update({
        where: { id, version: input.version },
        data: {
          name: merged.name.trim(),
          reportKey: def.key,
          params: merged.params as Prisma.InputJsonValue,
          cron: merged.cron.trim(),
          timezone: merged.timezone,
          recipients: merged.recipients,
          version: { increment: 1 },
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'reports.schedule_updated',
          entityType: 'ReportSchedule',
          entityId: id,
          summary: `${actor.name} updated the scheduled report "${updated.name}".`,
          ip: client.ip,
        },
        tx,
      );
      return updated;
    });
    // An edit while active re-syncs the repeatable job with the new cron.
    if (wasActive) await this.applySchedule(schedule.id);
    return schedule;
  }

  async deleteSchedule(actor: AuthUser, id: string, client: ClientInfo): Promise<void> {
    const existing = await this.scheduleRow(id);
    this.assertCanManageSchedule(actor, existing);
    await this.prisma.$transaction(async (tx) => {
      await tx.reportSchedule.delete({ where: { id } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'reports.schedule_deleted',
          entityType: 'ReportSchedule',
          entityId: id,
          summary: `${actor.name} deleted the scheduled report "${existing.name}".`,
          ip: client.ip,
        },
        tx,
      );
    });
    await this.queues.queue('reports').removeJobScheduler(scheduleJobId(id));
  }

  async activate(actor: Pick<AuthUser, 'id' | 'isAdmin'>, id: string): Promise<void> {
    const schedule = await this.scheduleRow(id);
    this.assertCanManageSchedule(actor, schedule);
    await this.prisma.reportSchedule.update({ where: { id }, data: { active: true } });
    await this.applySchedule(id);
  }

  async deactivate(actor: Pick<AuthUser, 'id' | 'isAdmin'>, id: string): Promise<void> {
    const schedule = await this.scheduleRow(id);
    this.assertCanManageSchedule(actor, schedule);
    await this.prisma.reportSchedule.update({ where: { id }, data: { active: false } });
    await this.queues.queue('reports').removeJobScheduler(scheduleJobId(id));
  }

  /** Makes BullMQ's repeatable job match the saved schedule: off means no job at all. */
  private async applySchedule(id: string): Promise<void> {
    const schedule = await this.prisma.reportSchedule.findUnique({ where: { id } });
    const queue = this.queues.queue('reports');
    if (schedule?.active) {
      await queue.upsertJobScheduler(
        scheduleJobId(id),
        { pattern: schedule.cron, tz: schedule.timezone },
        { name: RUN_REPORT_JOB, data: { scheduleId: id } },
      );
    } else {
      await queue.removeJobScheduler(scheduleJobId(id));
    }
  }

  /**
   * Re-registers every active schedule on boot, and drops BullMQ schedulers
   * with no matching schedule row — e.g. a schedule deleted while Redis was
   * failing would otherwise fire forever (the delete path couldn't remove its
   * job scheduler).
   */
  async reconcile(): Promise<void> {
    const active = await this.prisma.reportSchedule.findMany({
      where: { active: true },
      select: { id: true, cron: true, timezone: true },
    });
    const queue = this.queues.queue('reports');
    const expected = new Set(active.map((s) => scheduleJobId(s.id)));
    for (const s of active) {
      try {
        await queue.upsertJobScheduler(
          scheduleJobId(s.id),
          { pattern: s.cron, tz: s.timezone },
          { name: RUN_REPORT_JOB, data: { scheduleId: s.id } },
        );
      } catch (error) {
        this.logger.error(`Could not re-register schedule ${s.id}: ${(error as Error).message}`);
      }
    }
    try {
      const schedulers = await queue.getJobSchedulers();
      for (const js of schedulers) {
        // Only report-schedule ids: other features share the queue.
        const id = js.id ?? '';
        if (id.startsWith('report-schedule-') && !expected.has(id)) {
          await queue.removeJobScheduler(id);
          this.logger.warn(`Removed orphan report scheduler ${id} (no schedule row).`);
        }
      }
    } catch (error) {
      this.logger.error(`Could not drop orphan report schedulers: ${(error as Error).message}`);
    }
  }

  // ── Scheduled execution ───────────────────────────────────────────────────

  /** Worker entry point: re-reads the row, skips inactive/deleted, runs, emails. */
  async executeScheduled(job: Job<{ scheduleId: string }>): Promise<string> {
    const schedule = await this.prisma.reportSchedule.findUnique({
      where: { id: job.data.scheduleId },
    });
    if (!schedule) return 'Skipped: schedule was deleted';
    if (!schedule.active) return 'Skipped: switched off';

    const run = await this.prisma.reportRun.create({
      data: {
        scheduleId: schedule.id,
        reportKey: schedule.reportKey,
        params: (schedule.params ?? {}) as Prisma.InputJsonValue,
        trigger: 'SCHEDULE',
        requestedById: schedule.createdById,
      },
    });

    try {
      const scopeUser = await this.scopeFor(schedule.createdById);
      const def = this.definition(schedule.reportKey);
      const params = (schedule.params ?? {}) as ReportParams;
      const result = await def.run({ prisma: this.prisma, settings: this.settings, user: scopeUser, params });
      const csv = CSV_BOM + toCsv(result.columns, result.rows);
      const csvBuffer = Buffer.from(csv, 'utf8');
      const csvKey = await this.storage.save('reports', 'csv', csvBuffer);
      await this.prisma.reportRun.update({
        where: { id: run.id },
        data: { status: 'SUCCESS', rowCount: result.rows.length, csvKey, finishedAt: new Date() },
      });
      await this.prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: new Date() },
      });
      await this.emailReport(schedule, def, result, csvBuffer);
      return `Sent "${schedule.name}": ${result.rows.length} rows`;
    } catch (error) {
      const message = (error as Error).message;
      await this.prisma.reportRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: message.slice(0, 2000), finishedAt: new Date() },
      });
      return `Failed: ${message}`;
    }
  }

  /** v1 renders with the schedule creator's ticket scope for every recipient. */
  private async scopeFor(
    createdById: string | null,
  ): Promise<Pick<AuthUser, 'id' | 'ticketScope' | 'regionId'>> {
    if (!createdById) fail('SCHEDULE_NO_OWNER', 'The schedule has no owner.');
    const owner = await this.prisma.user.findUnique({
      where: { id: createdById },
      select: { id: true, regionId: true, role: { select: { ticketScope: true } } },
    });
    if (!owner) fail('SCHEDULE_NO_OWNER', 'The schedule owner no longer exists.');
    return { id: owner.id, ticketScope: owner.role.ticketScope, regionId: owner.regionId };
  }

  private async emailReport(
    schedule: { id: string; name: string },
    def: ReportDefinition,
    result: { rows: Record<string, unknown>[]; summary: Record<string, string | number> },
    csvBuffer: Buffer,
  ): Promise<void> {
    const recipients = await this.prisma.user.findMany({
      where: { id: { in: ((await this.scheduleRow(schedule.id)).recipients as string[]) }, status: 'ACTIVE' },
      select: { email: true },
    });
    const summary = Object.entries(result.summary)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    for (const r of recipients) {
      await this.email.queueEmail({
        templateKey: 'report.scheduled',
        to: r.email,
        variables: {
          scheduleName: schedule.name,
          reportLabel: def.label,
          rowCount: result.rows.length,
          summary,
          downloadNote:
            csvBuffer.length > MAX_EMAIL_ATTACHMENT_BYTES
              ? 'The file was too large to attach; download it from Reports → Scheduled reports → run history.'
              : '',
        },
        attachments:
          csvBuffer.length <= MAX_EMAIL_ATTACHMENT_BYTES
            ? [
                {
                  filename: `${schedule.name.replace(/[^\w\-]+/g, '_')}.csv`,
                  content: csvBuffer.toString('base64'),
                  contentType: 'text/csv',
                },
              ]
            : undefined,
      });
    }
  }

  // ── Run history ───────────────────────────────────────────────────────────

  /**
   * A run's output is readable by the schedule owner, its recipients, and
   * administrators. The internal storage key never leaves the API: callers get
   * only `hasFile` (whether a download exists).
   */
  async listRuns(
    actor: Pick<AuthUser, 'id' | 'isAdmin'>,
    scheduleId: string,
    page = 1,
    pageSize = 25,
  ) {
    const schedule = await this.scheduleRow(scheduleId);
    if (!this.canReadSchedule(actor, schedule)) {
      fail('SCHEDULE_NOT_FOUND', 'Report schedule not found.', HttpStatus.NOT_FOUND);
    }
    const runs = await this.prisma.reportRun.findMany({
      where: { scheduleId },
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        reportKey: true,
        trigger: true,
        status: true,
        rowCount: true,
        error: true,
        startedAt: true,
        finishedAt: true,
        csvKey: true,
        requestedBy: { select: { id: true, name: true } },
      },
    });
    return runs.map(({ csvKey, ...rest }) => ({ ...rest, hasFile: csvKey != null }));
  }

  async readRunCsv(
    actor: Pick<AuthUser, 'id' | 'isAdmin'>,
    runId: string,
  ): Promise<{ stream: ReadStream; filename: string }> {
    const run = await this.prisma.reportRun.findUnique({
      where: { id: runId },
      include: { schedule: { select: { createdById: true, recipients: true } } },
    });
    if (!run || !run.csvKey) {
      fail('RUN_NOT_FOUND', 'No stored file for this run.', HttpStatus.NOT_FOUND);
    }
    // Runs orphaned by a schedule deletion keep their requester as the reader.
    const allowed = run.schedule
      ? this.canReadSchedule(actor, run.schedule)
      : actor.isAdmin || run.requestedById === actor.id;
    if (!allowed) {
      fail('RUN_NOT_FOUND', 'No stored file for this run.', HttpStatus.NOT_FOUND);
    }
    return { stream: this.storage.read(run.csvKey), filename: `report-${run.id}.csv` };
  }

  // ── KPI targets ───────────────────────────────────────────────────────────

  getKpiTargets(): Promise<KpiTargets> {
    return this.kpi.getTargets();
  }

  updateKpiTargets(actor: AuthUser, targets: KpiTargets, client: ClientInfo): Promise<KpiTargets> {
    return this.kpi.updateTargets(actor, targets, client);
  }

  kpiMatrix(user: Pick<AuthUser, 'id' | 'ticketScope' | 'regionId'>, params: ReportParams) {
    return this.kpi.matrix(user, params);
  }

  // Re-exported for the controller's type surface.
  static readonly keys = REPORT_KEYS;
  static readonly rowCap = ROW_CAP;
}
