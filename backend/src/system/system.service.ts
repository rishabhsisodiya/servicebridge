import { HttpStatus, Injectable } from '@nestjs/common';
import type { Job, JobType } from 'bullmq';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { AuditService } from '../core/audit/audit.service';
import { AppException } from '../core/http/app.exception';
import { stripUrlCredentials } from '../core/logging/redact';
import { PrismaService } from '../core/prisma/prisma.service';
import { QUEUE_NAMES, QUEUES, type QueueName, QueueService } from '../core/queue/queue.service';

export const JOB_STATES = [
  'waiting',
  'active',
  'delayed',
  'completed',
  'failed',
  'paused',
] as const;
export type JobState = (typeof JOB_STATES)[number];

const SECRET_KEY = /password|secret|token|apikey|api_key|authorization|cookie/i;

/** Job data for display: secret-looking fields removed, long values shortened. */
export function safeJobData(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null) return {};
  return Object.fromEntries(
    Object.entries(data as Record<string, unknown>).map(([key, value]) => [
      key,
      SECRET_KEY.test(key)
        ? '[hidden]'
        : typeof value === 'string' && value.length > 200
          ? `${value.slice(0, 200)}…`
          : value,
    ]),
  );
}

function jobView(job: Job, state?: string) {
  const runAt = job.delay ? job.timestamp + job.delay : null;
  return {
    id: job.id,
    name: job.name,
    state: state ?? null,
    data: safeJobData(job.data),
    attemptsMade: job.attemptsMade,
    maxAttempts: job.opts.attempts ?? 1,
    createdAt: new Date(job.timestamp),
    processedAt: job.processedOn ? new Date(job.processedOn) : null,
    finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
    runAt: runAt ? new Date(runAt) : null,
    failedReason: job.failedReason ? stripUrlCredentials(job.failedReason) : null,
  };
}

@Injectable()
export class SystemService {
  constructor(
    private readonly queues: QueueService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private queue(name: string) {
    if (!(QUEUE_NAMES as string[]).includes(name)) {
      throw new AppException('QUEUE_NOT_FOUND', 'That queue does not exist.', HttpStatus.NOT_FOUND);
    }
    return this.queues.queue(name as QueueName);
  }

  private async job(queueName: string, id: string) {
    const job = await this.queue(queueName).getJob(id);
    if (!job)
      throw new AppException(
        'JOB_NOT_FOUND',
        'That job no longer exists. It may have finished and been cleaned up.',
        HttpStatus.NOT_FOUND,
      );
    return job;
  }

  async overview() {
    const dayAgo = Date.now() - 86_400_000;
    return Promise.all(
      QUEUE_NAMES.map(async (name) => {
        const queue = this.queues.queue(name);
        const [counts, paused, completed, failed] = await Promise.all([
          queue.getJobCounts(...JOB_STATES),
          queue.isPaused(),
          queue.getMetrics('completed', 0, 1440).catch(() => undefined),
          queue.getMetrics('failed', 0, 1440).catch(() => undefined),
        ]);
        const sum = (points?: number[]) => (points ?? []).reduce((total, n) => total + n, 0);
        return {
          name,
          label: QUEUES[name],
          paused,
          counts,
          // Metrics are per-minute buckets for the last 24 hours.
          last24h: {
            completed: sum(completed?.data),
            failed: sum(failed?.data),
            since: new Date(dayAgo),
          },
        };
      }),
    );
  }

  async jobs(queueName: string, state: JobState, page: number, pageSize = 25) {
    const queue = this.queue(queueName);
    const start = (page - 1) * pageSize;
    const [jobs, counts] = await Promise.all([
      queue.getJobs([state as JobType], start, start + pageSize - 1, state !== 'delayed'),
      queue.getJobCounts(state),
    ]);
    return {
      data: jobs.filter(Boolean).map((job) => jobView(job, state)),
      meta: { page, pageSize, total: counts[state] ?? 0 },
    };
  }

  async jobDetail(queueName: string, id: string) {
    const job = await this.job(queueName, id);
    const [state, logs] = await Promise.all([
      job.getState(),
      this.queue(queueName).getJobLogs(id, 0, 100),
    ]);
    return {
      ...jobView(job, state),
      logs: logs.logs.map(stripUrlCredentials),
      stacktrace: (job.stacktrace ?? []).map(stripUrlCredentials),
    };
  }

  private async record(
    actor: AuthUser,
    client: ClientInfo,
    action: string,
    summary: string,
    entityId?: string,
  ) {
    await this.audit.record({
      actorId: actor.id,
      action,
      entityType: 'queue_job',
      entityId,
      summary,
      ip: client.ip,
      requestId: client.requestId,
    });
  }

  async retry(actor: AuthUser, queueName: string, id: string, client: ClientInfo) {
    const job = await this.job(queueName, id);
    if ((await job.getState()) !== 'failed') {
      throw new AppException('NOT_FAILED', 'Only failed jobs can be retried.', HttpStatus.CONFLICT);
    }
    await job.retry();
    await this.record(
      actor,
      client,
      'queue.job_retried',
      `${actor.name} retried job ${id} (${job.name}) on ${queueName}`,
      id,
    );
  }

  async promote(actor: AuthUser, queueName: string, id: string, client: ClientInfo) {
    const job = await this.job(queueName, id);
    if ((await job.getState()) !== 'delayed') {
      throw new AppException(
        'NOT_DELAYED',
        'Only scheduled (delayed) jobs can be run now.',
        HttpStatus.CONFLICT,
      );
    }
    await job.promote();
    await this.record(
      actor,
      client,
      'queue.job_promoted',
      `${actor.name} ran scheduled job ${id} (${job.name}) on ${queueName} early`,
      id,
    );
  }

  async remove(actor: AuthUser, queueName: string, id: string, client: ClientInfo) {
    const job = await this.job(queueName, id);
    if ((await job.getState()) === 'active') {
      throw new AppException(
        'JOB_ACTIVE',
        'A running job can’t be removed. Wait for it to finish.',
        HttpStatus.CONFLICT,
      );
    }
    await job.remove();
    await this.record(
      actor,
      client,
      'queue.job_removed',
      `${actor.name} removed job ${id} (${job.name}) from ${queueName}`,
      id,
    );
  }

  async setPaused(actor: AuthUser, queueName: string, paused: boolean, client: ClientInfo) {
    const queue = this.queue(queueName);
    await (paused ? queue.pause() : queue.resume());
    await this.record(
      actor,
      client,
      paused ? 'queue.paused' : 'queue.resumed',
      `${actor.name} ${paused ? 'paused' : 'resumed'} the ${queueName} queue`,
    );
  }

  async retryAllFailed(actor: AuthUser, queueName: string, client: ClientInfo) {
    const queue = this.queue(queueName);
    const failed = await queue.getJobCounts('failed');
    await queue.retryJobs({ state: 'failed' });
    await this.record(
      actor,
      client,
      'queue.retried_failed',
      `${actor.name} retried ${failed.failed ?? 0} failed jobs on ${queueName}`,
    );
    return { retried: failed.failed ?? 0 };
  }

  async clean(
    actor: AuthUser,
    queueName: string,
    state: 'completed' | 'failed',
    olderThanDays: number,
    client: ClientInfo,
  ) {
    const removed = await this.queue(queueName).clean(olderThanDays * 86_400_000, 10_000, state);
    await this.record(
      actor,
      client,
      'queue.cleaned',
      `${actor.name} removed ${removed.length} ${state} jobs older than ${olderThanDays} days from ${queueName}`,
    );
    return { removed: removed.length };
  }

  async erpRequests(
    filters: { connectionId?: string; failedOnly?: boolean; page: number },
    pageSize = 50,
  ) {
    const where = {
      connectionId: filters.connectionId,
      ...(filters.failedOnly ? { ok: false } : {}),
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.erpRequestLog.count({ where }),
      this.prisma.erpRequestLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * pageSize,
        take: pageSize,
        include: { connection: { select: { name: true } } },
      }),
    ]);
    return { data, meta: { page: filters.page, pageSize, total } };
  }

  /** Health per connection: status plus the last 24 hours of ERP calls. */
  async connectionHealth() {
    const since = new Date(Date.now() - 86_400_000);
    const [connections, stats, failures] = await Promise.all([
      this.prisma.erpConnection.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          baseUrl: true,
          status: true,
          consecutiveFailures: true,
          lastTestedAt: true,
        },
      }),
      this.prisma.erpRequestLog.groupBy({
        by: ['connectionId'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _avg: { latencyMs: true },
      }),
      this.prisma.erpRequestLog.groupBy({
        by: ['connectionId'],
        where: { createdAt: { gte: since }, ok: false },
        _count: { _all: true },
      }),
    ]);
    const statsById = new Map(stats.map((s) => [s.connectionId, s]));
    const failedById = new Map(failures.map((f) => [f.connectionId, f._count._all]));
    const delayed = await this.queues.queue('system').getJobs(['delayed'], 0, 200);
    return connections.map((connection) => {
      const recovery = delayed.find((job) => job?.id?.startsWith(`recover:${connection.id}:`));
      return {
        ...connection,
        last24h: {
          requests: statsById.get(connection.id)?._count._all ?? 0,
          failed: failedById.get(connection.id) ?? 0,
          avgLatencyMs: Math.round(statsById.get(connection.id)?._avg.latencyMs ?? 0),
        },
        nextRecoveryCheckAt: recovery ? new Date(recovery.timestamp + recovery.delay) : null,
      };
    });
  }
}
