import { HttpStatus, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type JobTrigger, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { parseExpression } from 'cron-parser';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { AuditService } from '../core/audit/audit.service';
import { AppException, validationFailed } from '../core/http/app.exception';
import { stripUrlCredentials } from '../core/logging/redact';
import { PrismaService } from '../core/prisma/prisma.service';
import { type QueueName, QueueService } from '../core/queue/queue.service';

export type AutomationCategory = 'Service' | 'Maintenance' | 'ERP';

export interface AutomationDefinition {
  key: string;
  name: string;
  description: string;
  category: AutomationCategory;
  queue: QueueName;
  /** periodic: runs on a cron schedule. event: runs when something happens (timers, retries). */
  kind: 'periodic' | 'event';
  defaultEnabled: boolean;
  defaultCron?: string;
  /** Shortest allowed gap between scheduled runs. */
  minIntervalMinutes?: number;
}

export interface AutomationContext {
  job: Job<AutomationJobData>;
  trigger: JobTrigger;
  params: Record<string, unknown>;
  log: (line: string) => Promise<void>;
}

/** Returns a plain-English summary of what the run did. */
export type AutomationHandler = (context: AutomationContext) => Promise<string>;

export interface AutomationJobData {
  automationKey: string;
  trigger: JobTrigger;
  actorId?: string;
  [key: string]: unknown;
}

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** Validates a cron expression and the gap between its runs. Returns a problem or undefined. */
export function cronProblem(
  cron: string,
  timezone: string,
  minIntervalMinutes = 5,
): string | undefined {
  if (cron.trim().split(/\s+/).length !== 5) {
    return 'Use 5 parts: minute hour day-of-month month day-of-week, e.g. "0 3 * * 0".';
  }
  try {
    const interval = parseExpression(cron, { tz: timezone });
    const first = interval.next().getTime();
    const second = interval.next().getTime();
    if ((second - first) / 60_000 < minIntervalMinutes) {
      return `Runs must be at least ${minIntervalMinutes} minutes apart.`;
    }
  } catch {
    return 'That schedule is not a valid cron expression.';
  }
  return undefined;
}

function timezoneValid(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class AutomationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AutomationsService.name);
  private readonly definitions = new Map<
    string,
    { definition: AutomationDefinition; handler: AutomationHandler }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
  ) {}

  /** Called by feature modules (in onModuleInit) to add an automation. */
  define(definition: AutomationDefinition, handler: AutomationHandler): void {
    this.definitions.set(definition.key, { definition, handler });
    this.queues.register(definition.queue, definition.key, (job) =>
      this.execute(definition.key, job as Job<AutomationJobData>),
    );
  }

  private entry(key: string) {
    const entry = this.definitions.get(key);
    if (!entry)
      throw new AppException(
        'AUTOMATION_NOT_FOUND',
        'That automation does not exist.',
        HttpStatus.NOT_FOUND,
      );
    return entry;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.queues.workersEnabled) return;
    for (const { definition } of this.definitions.values()) {
      await this.prisma.automationSetting.upsert({
        where: { key: definition.key },
        create: {
          key: definition.key,
          enabled: definition.defaultEnabled,
          cron: definition.defaultCron ?? null,
        },
        update: {},
      });
      await this.applySchedule(definition.key).catch((error: Error) =>
        this.logger.error(
          { automation: definition.key, error: error.message },
          'Could not apply schedule',
        ),
      );
    }
  }

  /** Makes BullMQ's schedule match the saved setting: switched off means no schedule at all. */
  private async applySchedule(key: string): Promise<void> {
    const { definition } = this.entry(key);
    if (definition.kind !== 'periodic') return;
    const setting = await this.prisma.automationSetting.findUnique({ where: { key } });
    const queue = this.queues.queue(definition.queue);
    if (setting?.enabled && setting.cron) {
      await queue.upsertJobScheduler(
        key,
        { pattern: setting.cron, tz: setting.timezone },
        {
          name: key,
          data: { automationKey: key, trigger: 'SCHEDULE' } satisfies AutomationJobData,
        },
      );
    } else {
      await queue.removeJobScheduler(key);
    }
  }

  /** Worker entry point: checks the switch, records the run, calls the handler. */
  async execute(key: string, job: Job<AutomationJobData>): Promise<string> {
    const { definition, handler } = this.entry(key);
    const trigger = job.data.trigger ?? 'SCHEDULE';
    const setting = await this.prisma.automationSetting.findUnique({ where: { key } });
    const base = {
      automationKey: key,
      queue: definition.queue,
      jobId: job.id ?? null,
      trigger,
      actorId: job.data.actorId ?? null,
    };

    // A manual "Run now" works even when switched off; everything else respects the switch.
    if (!setting?.enabled && trigger !== 'MANUAL') {
      await this.prisma.jobRun.create({
        data: {
          ...base,
          status: 'SKIPPED',
          finishedAt: new Date(),
          summary: 'Skipped: switched off',
        },
      });
      return 'Skipped: switched off';
    }

    const run = await this.prisma.jobRun.create({ data: base });
    try {
      const summary = await handler({
        job,
        trigger,
        params: (setting?.params as Record<string, unknown>) ?? {},
        log: async (line) => {
          await job.log(line);
        },
      });
      await this.prisma.jobRun.update({
        where: { id: run.id },
        data: { status: 'SUCCEEDED', finishedAt: new Date(), summary },
      });
      return summary;
    } catch (error) {
      await this.prisma.jobRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: stripUrlCredentials((error as Error).message ?? String(error)).slice(0, 1000),
        },
      });
      throw error;
    }
  }

  async list() {
    const settings = new Map(
      (await this.prisma.automationSetting.findMany()).map((s) => [s.key, s]),
    );
    const lastRuns = await this.prisma.jobRun.findMany({
      where: { automationKey: { in: [...this.definitions.keys()] } },
      orderBy: { startedAt: 'desc' },
      distinct: ['automationKey'],
    });
    const lastByKey = new Map(lastRuns.map((run) => [run.automationKey, run]));

    return Promise.all(
      [...this.definitions.values()].map(async ({ definition }) => {
        const setting = settings.get(definition.key);
        let nextRunAt: Date | null = null;
        if (definition.kind === 'periodic' && setting?.enabled) {
          const scheduler = await this.queues
            .queue(definition.queue)
            .getJobScheduler(definition.key)
            .catch(() => undefined);
          nextRunAt = scheduler?.next ? new Date(scheduler.next) : null;
        }
        return {
          ...definition,
          enabled: setting?.enabled ?? definition.defaultEnabled,
          cron: setting?.cron ?? definition.defaultCron ?? null,
          timezone: setting?.timezone ?? DEFAULT_TIMEZONE,
          nextRunAt,
          lastRun: lastByKey.get(definition.key) ?? null,
        };
      }),
    );
  }

  async update(
    actor: AuthUser,
    key: string,
    input: { enabled?: boolean; cron?: string; timezone?: string },
    client: ClientInfo,
  ) {
    const { definition } = this.entry(key);
    const current = await this.prisma.automationSetting.findUnique({ where: { key } });
    const timezone = input.timezone ?? current?.timezone ?? DEFAULT_TIMEZONE;
    if (!timezoneValid(timezone))
      throw validationFailed([{ field: 'timezone', message: 'Choose a valid time zone.' }]);
    if (input.cron !== undefined) {
      if (definition.kind !== 'periodic') {
        throw validationFailed([
          { field: 'cron', message: 'This automation runs on events, not a schedule.' },
        ]);
      }
      const problem = cronProblem(input.cron, timezone, definition.minIntervalMinutes);
      if (problem) throw validationFailed([{ field: 'cron', message: problem }]);
    }

    const setting = await this.prisma.automationSetting.upsert({
      where: { key },
      create: {
        key,
        enabled: input.enabled ?? definition.defaultEnabled,
        cron: input.cron ?? definition.defaultCron ?? null,
        timezone,
        updatedById: actor.id,
      },
      update: {
        enabled: input.enabled,
        cron: input.cron,
        timezone: input.timezone,
        updatedById: actor.id,
      },
    });
    await this.applySchedule(key);

    const changes: string[] = [];
    if (input.enabled !== undefined && input.enabled !== current?.enabled)
      changes.push(input.enabled ? 'switched on' : 'switched off');
    if (input.cron !== undefined && input.cron !== current?.cron)
      changes.push(`schedule set to "${input.cron}"`);
    if (input.timezone !== undefined && input.timezone !== current?.timezone)
      changes.push(`time zone ${input.timezone}`);
    if (changes.length) {
      await this.audit.record({
        actorId: actor.id,
        action: 'automation.updated',
        entityType: 'automation',
        entityId: key,
        summary: `${actor.name} changed “${definition.name}”: ${changes.join(', ')}`,
        ip: client.ip,
        requestId: client.requestId,
      });
    }
    return setting;
  }

  async runNow(actor: AuthUser, key: string, client: ClientInfo): Promise<{ jobId: string }> {
    const { definition } = this.entry(key);
    const running = await this.prisma.jobRun.findFirst({
      where: {
        automationKey: key,
        status: 'RUNNING',
        startedAt: { gt: new Date(Date.now() - 3_600_000) },
      },
    });
    if (running) {
      throw new AppException(
        'JOB_ALREADY_RUNNING',
        `“${definition.name}” is already running. Wait for it to finish.`,
        HttpStatus.CONFLICT,
      );
    }
    const job = await this.queues.queue(definition.queue).add(key, {
      automationKey: key,
      trigger: 'MANUAL',
      actorId: actor.id,
    } satisfies AutomationJobData);
    await this.audit.record({
      actorId: actor.id,
      action: 'automation.run_now',
      entityType: 'automation',
      entityId: key,
      summary: `${actor.name} ran “${definition.name}” now`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return { jobId: job.id ?? '' };
  }

  async runs(key: string, page: number, pageSize = 20) {
    this.entry(key);
    const where: Prisma.JobRunWhereInput = { automationKey: key };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.jobRun.count({ where }),
      this.prisma.jobRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { data, meta: { page, pageSize, total } };
  }
}
