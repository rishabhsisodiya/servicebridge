import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, type JobsOptions, MetricsTime, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { AppConfig } from '../config/app-config.service';
import { stripUrlCredentials } from '../logging/redact';

/** One queue per area, so a backlog in one (e.g. a big sync) never delays another (e.g. SLA alerts). */
export const QUEUES = {
  system: 'Housekeeping and connection checks',
  'erp-sync': 'ERP data sync',
  'erp-writeback': 'ERP write-backs',
  sla: 'SLA timers',
  escalations: 'Ticket escalation timers',
  assignment: 'Automatic assignment',
  notifications: 'Notifications',
  quotations: 'Quotation expiry timers',
  amc: 'AMC scheduling',
  reports: 'Scheduled reports',
} as const;

export type QueueName = keyof typeof QUEUES;
export const QUEUE_NAMES = Object.keys(QUEUES) as QueueName[];

export type JobHandler = (job: Job) => Promise<unknown>;

const DAY = 86_400;

/** Keeps Redis bounded: history beyond this lives in Postgres (JobRun, ErpRequestLog). */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  removeOnComplete: { age: 7 * DAY, count: 1000 },
  removeOnFail: { age: 30 * DAY },
};

/**
 * BullMQ queues and workers. Features register a handler per job name;
 * workers start after the app has booted. Nothing connects to Redis until a
 * queue is first used, and workers never start in tests.
 */
@Injectable()
export class QueueService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];
  private readonly handlers = new Map<QueueName, Map<string, JobHandler>>();
  private readonly concurrency = new Map<QueueName, number>();
  private connection?: Redis;

  constructor(private readonly config: AppConfig) {}

  private redis(): Redis {
    // BullMQ requires maxRetriesPerRequest: null so blocking commands never give up.
    this.connection ??= new Redis(this.config.get('REDIS_URL'), { maxRetriesPerRequest: null });
    return this.connection;
  }

  queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.redis(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
      this.queues.set(name, queue);
    }
    return queue;
  }

  /** Registers what to do for `jobName` jobs on `queue`. Call from a module's constructor/onModuleInit. */
  register(
    queue: QueueName,
    jobName: string,
    handler: JobHandler,
    options: { concurrency?: number } = {},
  ): void {
    if (!this.handlers.has(queue)) this.handlers.set(queue, new Map());
    this.handlers.get(queue)!.set(jobName, handler);
    if (options.concurrency)
      this.concurrency.set(queue, Math.max(this.concurrency.get(queue) ?? 1, options.concurrency));
  }

  get workersEnabled(): boolean {
    return this.config.get('NODE_ENV') !== 'test';
  }

  onApplicationBootstrap(): void {
    if (!this.workersEnabled) return;
    for (const [name, handlers] of this.handlers) {
      const worker = new Worker(
        name,
        async (job) => {
          const handler = handlers.get(job.name);
          if (!handler) throw new Error(`No handler for job "${job.name}" on queue "${name}"`);
          return handler(job);
        },
        {
          // Each worker gets its own connection (it blocks while waiting for jobs).
          connection: new Redis(this.config.get('REDIS_URL'), { maxRetriesPerRequest: null }),
          concurrency: this.concurrency.get(name) ?? 1,
          metrics: { maxDataPoints: MetricsTime.ONE_WEEK },
        },
      );
      worker.on('failed', (job, error) =>
        this.logger.warn(
          {
            queue: name,
            job: job?.name,
            jobId: job?.id,
            attempts: job?.attemptsMade,
            error: stripUrlCredentials(error.message),
          },
          'Job failed',
        ),
      );
      worker.on('error', (error) =>
        this.logger.error(
          { queue: name, error: stripUrlCredentials(error.message) },
          'Worker error',
        ),
      );
      this.workers.push(worker);
    }
    this.logger.log(`Started ${this.workers.length} queue worker(s)`);
  }

  async onApplicationShutdown(): Promise<void> {
    // Let running jobs finish, then close connections.
    await Promise.allSettled(this.workers.map((worker) => worker.close()));
    await Promise.allSettled([...this.queues.values()].map((queue) => queue.close()));
    await this.connection?.quit().catch(() => undefined);
  }
}
