import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../core/prisma/prisma.service';
import { QueueService } from '../core/queue/queue.service';
import { AutomationsService } from '../automations/automations.service';

export const SLA_TIMERS_KEY = 'sla-timers';

type TimerKind = 'risk' | 'breach';

interface TimerData {
  automationKey: string;
  trigger: 'EVENT';
  ticketId: string;
  kind: TimerKind;
  clock: 'response' | 'resolution';
  /** The due time the timer was set for; a changed ticket makes the timer stale. */
  dueAt: string;
}

export interface TimerTicket {
  id: string;
  slaDueAt: Date | null;
  slaRiskAt: Date | null;
  respondedAt: Date | null;
}

/** BullMQ job ids can't contain ":"; one fixed id per ticket and kind makes rescheduling idempotent. */
const jobId = (ticketId: string, kind: TimerKind) => `sla-${ticketId}-${kind}`;

/** A job that is running right now is locked and can't be removed; its handler sees the change and skips. */
const removeQuietly = (queue: Queue, id: string) => queue.remove(id).catch(() => 0);

/**
 * One delayed job per ticket for "at risk" and one for "breached", on the
 * running SLA clock only. No polling: every change to a ticket's clock calls
 * sync(), which replaces its jobs. Handlers re-read the ticket before acting.
 */
@Injectable()
export class SlaTimersService implements OnModuleInit {
  private readonly logger = new Logger(SlaTimersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly automations: AutomationsService,
  ) {}

  onModuleInit(): void {
    this.automations.define(
      {
        key: SLA_TIMERS_KEY,
        name: 'SLA alerts',
        description:
          'Marks a ticket "at risk" when the last quarter of its response or resolution time starts, and "breached" when the time runs out. Each ticket sets its own two timers; nothing runs when there are no open tickets.',
        category: 'Service',
        queue: 'sla',
        kind: 'event',
        defaultEnabled: true,
      },
      async ({ job }) => this.fire(job.data as unknown as TimerData),
    );
  }

  /** Replaces the ticket's timers to match its running clock. Never throws: a Redis outage must not block ticket work. */
  async sync(ticket: TimerTicket): Promise<void> {
    try {
      const queue = this.queues.queue('sla');
      await Promise.all(
        (['risk', 'breach'] as const).map((kind) => removeQuietly(queue, jobId(ticket.id, kind))),
      );
      if (!ticket.slaDueAt) return;
      const now = Date.now();
      const clock = ticket.respondedAt ? 'resolution' : 'response';
      const plan: [TimerKind, Date | null][] = [
        ['risk', ticket.slaRiskAt],
        ['breach', ticket.slaDueAt],
      ];
      for (const [kind, at] of plan) {
        // A risk time already past is not re-announced; a past due time fires at once.
        if (!at || (kind === 'risk' && at.getTime() <= now)) continue;
        const data: TimerData = {
          automationKey: SLA_TIMERS_KEY,
          trigger: 'EVENT',
          ticketId: ticket.id,
          kind,
          clock,
          dueAt: ticket.slaDueAt.toISOString(),
        };
        await queue.add(SLA_TIMERS_KEY, data, {
          jobId: jobId(ticket.id, kind),
          delay: Math.max(0, at.getTime() - now),
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
        });
      }
    } catch (error) {
      this.logger.error(
        `Could not schedule SLA timers for ${ticket.id}: ${(error as Error).message}`,
      );
    }
  }

  /** Removes the ticket's timers (e.g. when demo tickets are cleared). */
  async cancel(ticketIds: string[]): Promise<void> {
    try {
      const queue = this.queues.queue('sla');
      await Promise.all(
        ticketIds.flatMap((id) =>
          (['risk', 'breach'] as const).map((kind) => removeQuietly(queue, jobId(id, kind))),
        ),
      );
    } catch (error) {
      this.logger.error(`Could not remove SLA timers: ${(error as Error).message}`);
    }
  }

  /** The ticket's pending timers, for the "Scheduled" panel. */
  async scheduled(ticketId: string) {
    try {
      const queue = this.queues.queue('sla');
      const jobs = await Promise.all(
        (['risk', 'breach'] as const).map(async (kind) => {
          const job = await queue.getJob(jobId(ticketId, kind));
          if (!job) return null;
          const data = job.data as TimerData;
          return {
            kind,
            clock: data.clock,
            runAt: new Date(job.timestamp + (job.opts.delay ?? 0)),
            state: await job.getState(),
          };
        }),
      );
      return { available: true, timers: jobs.filter((j) => j !== null) };
    } catch {
      return { available: false, timers: [] };
    }
  }

  private async fire(data: TimerData): Promise<string> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: data.ticketId },
      select: { id: true, number: true, slaDueAt: true },
    });
    if (!ticket) return 'Skipped: ticket no longer exists';
    if (ticket.slaDueAt?.toISOString() !== data.dueAt) {
      return `Skipped: ${ticket.number} changed since the timer was set`;
    }
    const label = data.clock === 'response' ? 'Response' : 'Resolution';
    if (data.kind === 'risk') {
      await this.prisma.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          type: 'SLA_AT_RISK',
          data: { clock: data.clock, dueAt: data.dueAt },
        },
      });
      return `${ticket.number}: ${label.toLowerCase()} time at risk`;
    }
    await this.prisma.$transaction([
      this.prisma.ticket.update({
        where: { id: ticket.id },
        data: data.clock === 'response' ? { responseBreached: true } : { resolutionBreached: true },
      }),
      this.prisma.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          type: 'SLA_BREACHED',
          data: { clock: data.clock, dueAt: data.dueAt },
        },
      }),
    ]);
    return `${ticket.number}: ${label.toLowerCase()} time breached`;
  }
}
