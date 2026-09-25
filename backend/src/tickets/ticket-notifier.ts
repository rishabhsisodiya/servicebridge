import { Injectable } from '@nestjs/common';
import type { NotificationType } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { TicketAction } from './workflow';

interface NotifyTicket {
  id: string;
  number: string;
  title: string;
  engineerId: string | null;
  areaManagerId: string | null;
}

interface Actor {
  id: string | null;
  name: string;
}

/**
 * Who hears about what (in-app bell; email reuses this in session 12):
 * - engineer: assigned, taken off, sent back or reopened; SLA alerts on their tickets
 * - area manager: new ticket in their region, declined, resolved (to verify); SLA alerts
 * - service managers: tickets that match no region; SLA breaches; declines/resolutions with no area manager
 * The person who acted is never notified about their own action.
 */
@Injectable()
export class TicketNotifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async serviceManagers(): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { role: 'SERVICE_MANAGER', status: 'ACTIVE' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** The area manager, or the service managers when the ticket has none. */
  private async managersFor(ticket: NotifyTicket): Promise<string[]> {
    return ticket.areaManagerId ? [ticket.areaManagerId] : this.serviceManagers();
  }

  private send(
    type: NotificationType,
    ticket: NotifyTicket,
    userIds: (string | null)[],
    title: string,
    actor?: Actor,
    body: string | null = ticket.title,
  ) {
    return this.notifications.notify({
      type,
      ticketId: ticket.id,
      userIds,
      title,
      body,
      exceptUserId: actor?.id,
    });
  }

  async created(ticket: NotifyTicket, actor: Actor, regionName: string | null): Promise<void> {
    if (ticket.areaManagerId) {
      await this.send(
        'TICKET_NEW',
        ticket,
        [ticket.areaManagerId],
        `New ticket ${ticket.number}${regionName ? ` in ${regionName}` : ''}`,
        actor,
      );
    } else {
      await this.send(
        'TICKET_UNROUTED',
        ticket,
        await this.serviceManagers(),
        `${ticket.number} matches no region — assign it`,
        actor,
      );
    }
  }

  async action(
    action: TicketAction,
    before: NotifyTicket,
    after: NotifyTicket,
    actor: Actor,
    note: string | null,
  ): Promise<void> {
    switch (action) {
      case 'assign':
        await this.send(
          'TICKET_ASSIGNED',
          after,
          [after.engineerId],
          `Assigned to you: ${after.number}`,
          actor,
        );
        if (before.engineerId && before.engineerId !== after.engineerId) {
          await this.send(
            'TICKET_UNASSIGNED',
            after,
            [before.engineerId],
            `${after.number} was reassigned to someone else`,
            actor,
          );
        }
        return;
      case 'decline':
        await this.send(
          'TICKET_DECLINED',
          after,
          await this.managersFor(after),
          `${actor.name} declined ${after.number}`,
          actor,
          note,
        );
        return;
      case 'resolve':
        await this.send(
          'TICKET_RESOLVED',
          after,
          await this.managersFor(after),
          `${after.number} is resolved — please verify`,
          actor,
          note,
        );
        return;
      case 'reject':
        await this.send(
          'TICKET_SENT_BACK',
          after,
          [after.engineerId],
          `${after.number} was sent back to you`,
          actor,
          note,
        );
        return;
      case 'reopen':
        await this.send(
          'TICKET_SENT_BACK',
          after,
          [after.engineerId, ...(after.engineerId ? [] : await this.managersFor(after))],
          `${after.number} was reopened`,
          actor,
          note,
        );
        return;
      default:
        return;
    }
  }

  async sla(kind: 'risk' | 'breach', clock: 'response' | 'resolution', ticket: NotifyTicket) {
    const what = clock === 'response' ? 'response' : 'resolution';
    if (kind === 'risk') {
      await this.send(
        'SLA_AT_RISK',
        ticket,
        [ticket.engineerId, ...(await this.managersFor(ticket))],
        `${ticket.number}: ${what} time at risk`,
      );
      return;
    }
    await this.send(
      'SLA_BREACHED',
      ticket,
      [ticket.engineerId, ticket.areaManagerId, ...(await this.serviceManagers())],
      `${ticket.number}: ${what} time missed`,
    );
  }
}
