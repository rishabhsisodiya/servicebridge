import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AutomationsService } from '../automations/automations.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { QueueService } from '../core/queue/queue.service';
import { pickAutoAssignee, rankEngineers } from './assignment';
import { EngineersService } from './engineers.service';
import { TicketNotifier } from './ticket-notifier';

export const AUTO_ASSIGN_KEY = 'tickets.auto-assign';

/**
 * Optional automatic assignment of new tickets (off by default). One job per
 * new ticket; the handler re-reads the ticket, so a manager who assigns first wins.
 */
@Injectable()
export class AutoAssignService implements OnModuleInit {
  private readonly logger = new Logger(AutoAssignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly automations: AutomationsService,
    private readonly engineers: EngineersService,
    private readonly notifier: TicketNotifier,
  ) {}

  onModuleInit(): void {
    this.automations.define(
      {
        key: AUTO_ASSIGN_KEY,
        name: 'Assign new tickets automatically',
        description:
          'When a ticket is logged, assigns the best engineer who is on duty and has the machine’s skill or works in the site’s region (fewest open tickets first). If nobody fits, the ticket waits for the area manager. Off: managers assign from the suggestions.',
        category: 'Service',
        queue: 'assignment',
        kind: 'event',
        defaultEnabled: false,
      },
      async ({ job }) => this.assign((job.data as unknown as { ticketId: string }).ticketId),
    );
  }

  /** Queues assignment for a new ticket if the automation is on. Never throws. */
  async queue(ticketId: string): Promise<void> {
    try {
      if (!(await this.automations.isEnabled(AUTO_ASSIGN_KEY))) return;
      await this.queues.queue('assignment').add(
        AUTO_ASSIGN_KEY,
        { automationKey: AUTO_ASSIGN_KEY, trigger: 'EVENT', ticketId },
        {
          jobId: `assign-${ticketId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
        },
      );
    } catch (error) {
      this.logger.error(`Could not queue assignment for ${ticketId}: ${(error as Error).message}`);
    }
  }

  async assign(ticketId: string): Promise<string> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { equipment: { select: { itemCode: true } } },
    });
    if (!ticket) return 'Skipped: ticket no longer exists';
    if (ticket.engineerId || !['NEW', 'TRIAGED'].includes(ticket.stage)) {
      return `Skipped: ${ticket.number} was already handled`;
    }
    const ranked = rankEngineers(await this.engineers.candidates(), {
      regionId: ticket.regionId,
      itemCode: ticket.equipment?.itemCode ?? null,
      engineerId: null,
    });
    const pick = pickAutoAssignee(ranked);
    if (!pick) {
      await this.prisma.ticketEvent.create({
        data: {
          ticketId,
          type: 'NOTE',
          note: 'Automatic assignment found no on-duty engineer with the right skill or region. Waiting for a manager.',
        },
      });
      return `${ticket.number}: no suitable engineer on duty`;
    }

    // Only if nobody changed the ticket in the meantime (version check).
    const { count } = await this.prisma.ticket.updateMany({
      where: { id: ticketId, version: ticket.version, engineerId: null },
      data: { engineerId: pick.id, stage: 'ASSIGNED', version: { increment: 1 } },
    });
    if (!count) return `Skipped: ${ticket.number} changed before it could be assigned`;
    await this.prisma.ticketEvent.create({
      data: {
        ticketId,
        type: 'ASSIGNED',
        fromStage: ticket.stage,
        toStage: 'ASSIGNED',
        data: {
          action: 'assign',
          auto: true,
          engineerId: pick.id,
          engineerName: pick.name,
          reason: pick.skills.length ? `skill: ${pick.skills.join(', ')}` : 'same region',
        },
      },
    });
    await this.notifier.action(
      'assign',
      ticket,
      { ...ticket, engineerId: pick.id },
      { id: null, name: 'ERPTick' },
      null,
    );
    return `${ticket.number}: assigned to ${pick.name}`;
  }
}
