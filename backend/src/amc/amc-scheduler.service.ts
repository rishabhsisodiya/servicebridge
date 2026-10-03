import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { AuthUser } from '../auth/auth.types';
import type { Permission } from '../auth/permissions';
import { AppConfig } from '../core/config/app-config.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { QueueService } from '../core/queue/queue.service';
import { AppSettingsService } from '../demo/app-settings.service';
import { rolesWith } from '../roles/role-filters';
import { EmailService } from '../notifications/email.service';
import { WhatsAppService } from '../notifications/whatsapp.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AutomationsService, type AutomationContext } from '../automations/automations.service';
import { TicketsService } from '../tickets/tickets.service';

export const AMC_PM_TICKETS_KEY = 'amc-pm-tickets';
export const AMC_RENEWALS_KEY = 'amc-renewals';
/** The expiry job is not an automation — flipping EXPIRED is bookkeeping, not optional. */
export const AMC_EXPIRY_JOB = 'amc-expiry';

const DAY_MS = 86_400_000;
const RENEWAL_REMINDERS = [60, 30, 7] as const;

/** BullMQ job ids can't contain ":"; one fixed id per visit makes rescheduling idempotent. */
const pmJobId = (plannedVisitId: string) => `amc-pm-${plannedVisitId}`;
const renewalJobId = (contractId: string, daysOut: number) => `amc-renewal-${contractId}-${daysOut}`;
const expiryJobId = (contractId: string) => `amc-expire-${contractId}`;

/** A job that is running right now is locked and can't be removed; its handler sees the change and skips. */
const removeQuietly = (queue: Queue, id: string) => queue.remove(id).catch(() => 0);

/** The scheduler acts as ERPTick itself, never as a person. */
const systemActor: AuthUser = {
  id: 'system',
  email: '',
  name: 'AMC scheduler',
  roleId: '',
  isAdmin: false,
  ticketScope: 'ALL',
  regionId: null,
  permissions: ['tickets.create', 'tickets.read', 'tickets.assign'] as Permission[],
  sessionId: '',
  stepUpAt: null,
};

interface PmJobData {
  automationKey: string;
  plannedVisitId: string;
}

interface RenewalJobData {
  automationKey: string;
  contractId: string;
  daysOut: number;
}

interface ExpiryJobData {
  contractId: string;
}

/**
 * Per-record timers for AMC contracts, on the `amc` queue. No polling:
 * every change to a contract replaces its jobs, and every handler re-reads
 * the database before acting, so a stale job is always a no-op.
 */
@Injectable()
export class AmcSchedulerService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(AmcSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly automations: AutomationsService,
    private readonly tickets: TicketsService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly whatsapp: WhatsAppService,
    private readonly settings: AppSettingsService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.automations.define(
      {
        key: AMC_PM_TICKETS_KEY,
        name: 'AMC preventive-maintenance tickets',
        description:
          'Creates a ticket for each planned visit, a few days before it is due. Each visit sets its own timer when the contract is activated; nothing runs when there are no upcoming visits.',
        category: 'Service',
        queue: 'amc',
        kind: 'event',
        defaultEnabled: false,
      },
      async (context) => this.firePm(context),
    );
    this.automations.define(
      {
        key: AMC_RENEWALS_KEY,
        name: 'AMC renewal reminders',
        description:
          'Notifies everyone who can manage AMC contracts 60, 30 and 7 days before a contract ends. Each active contract sets its own timers.',
        category: 'Service',
        queue: 'amc',
        kind: 'event',
        defaultEnabled: false,
      },
      async (context) => this.fireRenewal(context),
    );
    this.queues.register('amc', AMC_EXPIRY_JOB, async (job) => this.fireExpiry(job.data as ExpiryJobData));
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.syncAll().catch((error: Error) =>
      this.logger.error(`Could not rebuild AMC timers on start: ${error.message}`),
    );
  }

  /**
   * Rebuilds one contract's timers to match its current state. Never throws: a
   * Redis outage must not block contract work.
   */
  async sync(contractId: string): Promise<void> {
    try {
      const queue = this.queues.queue('amc');
      const contract = await this.prisma.amcContract.findUnique({
        where: { id: contractId },
        select: {
          id: true,
          status: true,
          endsOn: true,
          plannedVisits: { select: { id: true, plannedOn: true, status: true } },
        },
      });
      await removeQuietly(queue, expiryJobId(contractId));
      const visitIds = contract?.plannedVisits.map((v) => v.id) ?? [];
      await Promise.all([
        ...visitIds.map((id) => removeQuietly(queue, pmJobId(id))),
        ...RENEWAL_REMINDERS.map((daysOut) => removeQuietly(queue, renewalJobId(contractId, daysOut))),
      ]);
      if (!contract || contract.status !== 'ACTIVE') return;

      const now = Date.now();
      const delayUntil = (at: Date) => Math.max(0, at.getTime() - now);

      // Expiry: the day after the inclusive endsOn.
      await queue.add(
        AMC_EXPIRY_JOB,
        { contractId } satisfies ExpiryJobData,
        { jobId: expiryJobId(contractId), delay: delayUntil(new Date(contract.endsOn.getTime() + DAY_MS)) },
      );

      if (await this.automations.isEnabled(AMC_PM_TICKETS_KEY)) {
        const { pmLeadTimeDays } = await this.settings.amc();
        for (const visit of contract.plannedVisits) {
          if (visit.status !== 'PLANNED') continue;
          const fireAt = new Date(visit.plannedOn.getTime() - pmLeadTimeDays * DAY_MS);
          await queue.add(
            AMC_PM_TICKETS_KEY,
            { automationKey: AMC_PM_TICKETS_KEY, plannedVisitId: visit.id } satisfies PmJobData,
            { jobId: pmJobId(visit.id), delay: delayUntil(fireAt) },
          );
        }
      }

      if (await this.automations.isEnabled(AMC_RENEWALS_KEY)) {
        for (const daysOut of RENEWAL_REMINDERS) {
          const fireAt = new Date(contract.endsOn.getTime() - daysOut * DAY_MS);
          await queue.add(
            AMC_RENEWALS_KEY,
            { automationKey: AMC_RENEWALS_KEY, contractId, daysOut } satisfies RenewalJobData,
            { jobId: renewalJobId(contractId, daysOut), delay: delayUntil(fireAt) },
          );
        }
      }
    } catch (error) {
      this.logger.error(`Could not sync AMC timers for ${contractId}: ${(error as Error).message}`);
    }
  }

  /** Removes every timer for a contract. Never throws. */
  async cancel(contractId: string): Promise<void> {
    try {
      const queue = this.queues.queue('amc');
      const visits = await this.prisma.amcPlannedVisit.findMany({
        where: { contractId },
        select: { id: true },
      });
      await Promise.all([
        removeQuietly(queue, expiryJobId(contractId)),
        ...visits.map((v) => removeQuietly(queue, pmJobId(v.id))),
        ...RENEWAL_REMINDERS.map((daysOut) => removeQuietly(queue, renewalJobId(contractId, daysOut))),
      ]);
    } catch (error) {
      this.logger.error(`Could not cancel AMC timers for ${contractId}: ${(error as Error).message}`);
    }
  }

  /** Rebuilds timers for every active contract (used on API start). */
  async syncAll(): Promise<void> {
    const contracts = await this.prisma.amcContract.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });
    for (const contract of contracts) await this.sync(contract.id);
  }

  // ─── Job handlers ─────────────────────────────────────────────────────────

  private async firePm({ job, log }: AutomationContext): Promise<string> {
    const { plannedVisitId } = job.data as unknown as PmJobData;
    const visit = await this.prisma.amcPlannedVisit.findUnique({
      where: { id: plannedVisitId },
      include: {
        contract: {
          include: {
            customer: { select: { id: true, name: true } },
            serviceType: { select: { id: true, name: true, defaultPriority: true, requiresEquipment: true } },
            equipment: { select: { equipmentId: true } },
          },
        },
        equipment: { select: { id: true, itemName: true, serialNo: true } },
      },
    });
    if (!visit) return 'Skipped: the planned visit no longer exists';
    if (visit.status !== 'PLANNED') return `Skipped: visit is ${visit.status.toLowerCase()}`;
    const contract = visit.contract;
    if (contract.status !== 'ACTIVE') return `Skipped: contract is ${contract.status.toLowerCase()}`;

    const serviceType =
      contract.serviceType ??
      (await this.prisma.serviceType.findFirst({ where: { active: true }, orderBy: { sortOrder: 'asc' } }));
    if (!serviceType) {
      await log('No active service type exists, so the PM ticket was not created');
      return 'Skipped: no active service type';
    }
    const equipmentId = visit.equipmentId ?? contract.equipment[0]?.equipmentId ?? null;
    if (serviceType.requiresEquipment && !equipmentId) {
      await log('The service type needs a machine, but none is covered by the contract');
      return 'Skipped: no machine to put on the ticket';
    }
    const equipmentName = visit.equipment
      ? (visit.equipment.itemName ?? visit.equipment.serialNo)
      : equipmentId
        ? 'a covered machine'
        : null;
    try {
      const { id, number } = await this.tickets.create(
        systemActor,
        {
          customerId: contract.customerId,
          serviceTypeId: serviceType.id,
          channel: 'AMC_VISIT',
          priority: serviceType.defaultPriority,
          title: `Preventive maintenance — ${contract.number}${equipmentName ? ` — ${equipmentName}` : ''}`,
          description: `Planned visit of ${visit.plannedOn.toISOString().slice(0, 10)} under AMC contract ${contract.number}.`,
          equipmentId: equipmentId ?? undefined,
          acknowledgeDuplicates: true,
        },
        { createdById: null },
      );
      // Preferred engineer, or triage when there is none / the assignment fails.
      if (contract.preferredEngineerId) {
        try {
          const detail = await this.tickets.detail(systemActor, id);
          await this.tickets.act(systemActor, id, {
            action: 'assign',
            engineerId: contract.preferredEngineerId,
            version: detail.version,
          });
        } catch (error) {
          await log(`Preferred engineer could not be assigned: ${(error as Error).message}; ticket stays in triage`);
        }
      }
      await this.prisma.amcPlannedVisit.update({
        where: { id: visit.id },
        data: { status: 'CREATED', ticketId: id },
      });
      return `Created ticket ${number} for the visit of ${visit.plannedOn.toISOString().slice(0, 10)}`;
    } catch (error) {
      await log(`Ticket creation failed: ${(error as Error).message}`);
      throw error;
    }
  }

  private async fireRenewal({ job }: AutomationContext): Promise<string> {
    const { contractId, daysOut } = job.data as unknown as RenewalJobData;
    const contract = await this.prisma.amcContract.findUnique({
      where: { id: contractId },
      include: { customer: { select: { name: true, email: true } } },
    });
    if (!contract) return 'Skipped: the contract no longer exists';
    if (contract.status !== 'ACTIVE') return `Skipped: contract is ${contract.status.toLowerCase()}`;
    const endsOn = contract.endsOn.toISOString().slice(0, 10);

    const managers = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: rolesWith('amc.edit') },
      select: { id: true, email: true, phone: true },
    });
    const title = `AMC ${contract.number} ends in ${daysOut} days`;
    const body = `${contract.customer.name}'s contract ends on ${endsOn}. Follow up on the renewal.`;
    await this.notifications.notify({
      userIds: managers.map((m) => m.id),
      type: 'AMC_RENEWAL',
      title,
      body,
    });
    // One rendered email per manager with an address.
    let sent = 0;
    for (const manager of managers) {
      if (!manager.email) continue;
      const queued = await this.email.queueEmail({
        to: manager.email,
        templateKey: 'amc.renewal',
        variables: {
          contractNumber: contract.number,
          customerName: contract.customer.name,
          endsOn,
          daysLeft: daysOut,
        },
      });
      if (queued) sent += 1;
      // The WhatsApp reminder is independent of the email one: it goes out
      // whenever the channel is on and the manager has a usable number.
      await this.whatsapp.queueWhatsApp({
        to: manager.phone,
        templateKey: 'amc.renewal',
        variables: {
          contractNumber: contract.number,
          customerName: contract.customer.name,
          endsOn,
          daysLeft: daysOut,
        },
      });
    }
    return `Reminded ${managers.length} contract manager(s) (${sent} email(s)) about ${contract.number}`;
  }

  private async fireExpiry(data: ExpiryJobData): Promise<void> {
    const contract = await this.prisma.amcContract.findUnique({
      where: { id: data.contractId },
      select: { id: true, status: true, number: true, equipment: { select: { equipmentId: true } } },
    });
    if (!contract || contract.status !== 'ACTIVE') return;
    await this.prisma.amcContract.update({ where: { id: contract.id }, data: { status: 'EXPIRED' } });
    this.logger.log(`AMC contract ${contract.number} expired`);
  }
}
