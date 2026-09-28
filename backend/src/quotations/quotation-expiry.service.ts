import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import { QueueService } from '../core/queue/queue.service';
import { AutomationsService } from '../automations/automations.service';
import { AuditService } from '../core/audit/audit.service';
import { TicketNotifier } from '../tickets/ticket-notifier';

export const QUOTATION_EXPIRY_KEY = 'quotation-expiry';

interface ExpiryData {
  automationKey: string;
  trigger: 'EVENT';
  quotationId: string;
  /** The valid-until the timer was set for; a changed quotation makes it stale. */
  validUntil: string;
}

/** BullMQ job ids can't contain ":"; one fixed id per quotation makes rescheduling idempotent. */
const jobId = (quotationId: string) => `quotation-${quotationId}-expiry`;

/** One day, so the timer fires the morning after the valid-until date passes. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One delayed job per sent quotation. No polling: sending (re)schedules the
 * quotation's own timer; a PO, revision or cancellation withdraws it. The
 * automation switch (off by default) is respected both when scheduling and when
 * the job fires. Handlers re-read the database before acting.
 */
@Injectable()
export class QuotationExpiryService implements OnModuleInit {
  private readonly logger = new Logger(QuotationExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly automations: AutomationsService,
    private readonly notifier: TicketNotifier,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.automations.define(
      {
        key: QUOTATION_EXPIRY_KEY,
        name: 'Quotation expiry',
        description:
          'Marks sent quotations EXPIRED the morning after their valid-until date passes, and tells customer support. Each sent quotation sets its own timer; nothing runs when there are no sent quotations.',
        category: 'Service',
        queue: 'quotations',
        kind: 'event',
        defaultEnabled: false,
      },
      async ({ job }) => this.fire(job.data as unknown as ExpiryData),
    );
  }

  /**
   * (Re)schedules the quotation's expiry timer. Never throws: a Redis outage
   * must not block quotation work.
   */
  async sync(quotation: { id: string; validUntil: Date }): Promise<void> {
    try {
      const queue = this.queues.queue('quotations');
      await queue.remove(jobId(quotation.id)).catch(() => 0);
      // The automation is off by default; only schedule when it is switched on.
      if (!(await this.automations.isEnabled(QUOTATION_EXPIRY_KEY))) return;
      const runAt = quotation.validUntil.getTime() + DAY_MS;
      const data: ExpiryData = {
        automationKey: QUOTATION_EXPIRY_KEY,
        trigger: 'EVENT',
        quotationId: quotation.id,
        validUntil: quotation.validUntil.toISOString(),
      };
      await queue.add(QUOTATION_EXPIRY_KEY, data, {
        jobId: jobId(quotation.id),
        delay: Math.max(0, runAt - Date.now()),
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
      });
    } catch (error) {
      this.logger.error(
        `Could not schedule quotation expiry for ${quotation.id}: ${(error as Error).message}`,
      );
    }
  }

  /** Withdraws the quotation's timer (PO received, revised, cancelled). Never throws. */
  async cancel(quotationId: string): Promise<void> {
    try {
      await this.queues.queue('quotations').remove(jobId(quotationId)).catch(() => 0);
    } catch (error) {
      this.logger.error(
        `Could not remove quotation expiry for ${quotationId}: ${(error as Error).message}`,
      );
    }
  }

  private async fire(data: ExpiryData): Promise<string> {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: data.quotationId },
      select: {
        id: true,
        number: true,
        status: true,
        validUntil: true,
        ticket: { select: { id: true, number: true, title: true } },
      },
    });
    if (!quotation) return 'Skipped: quotation no longer exists';
    if (quotation.status !== 'SENT') {
      return `Skipped: ${quotation.number} is ${quotation.status.toLowerCase()}`;
    }
    if (quotation.validUntil.toISOString() !== data.validUntil) {
      return `Skipped: ${quotation.number} changed since the timer was set`;
    }
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    if (quotation.validUntil.getTime() > startOfToday.getTime()) {
      return `Skipped: ${quotation.number} is still valid`;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.quotation.update({
        where: { id: quotation.id },
        data: { status: 'EXPIRED', version: { increment: 1 } },
      });
      await this.audit.record(
        {
          actorId: null,
          action: 'quotation.expired',
          entityType: 'Quotation',
          entityId: quotation.id,
          summary: `Quotation ${quotation.number} on ticket ${quotation.ticket.number} expired`,
        },
        tx,
      );
    });
    await this.notifier.quotationExpired(
      { id: quotation.ticket.id, number: quotation.ticket.number, title: quotation.ticket.title },
      quotation.number,
    );
    return `${quotation.number}: expired`;
  }
}
