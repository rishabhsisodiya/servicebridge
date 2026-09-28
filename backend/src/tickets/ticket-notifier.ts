import { Injectable } from '@nestjs/common';
import type { NotificationType } from '@prisma/client';
import { AppConfig } from '../core/config/app-config.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { EmailService, type TemplateVariables } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { rolesWith } from '../roles/role-filters';
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
 * - escalation recipients (service managers by default): tickets that match no region; SLA breaches; declines/resolutions with no area manager
 * The person who acted is never notified about their own action.
 */
@Injectable()
export class TicketNotifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly config: AppConfig,
  ) {}

  /** Everyone whose role receives escalations (service managers, by default). */
  private async escalationRecipients(): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { role: rolesWith('tickets.escalations'), status: 'ACTIVE' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** The area manager, or the service managers when the ticket has none. */
  private async managersFor(ticket: NotifyTicket): Promise<string[]> {
    return ticket.areaManagerId ? [ticket.areaManagerId] : this.escalationRecipients();
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

  private ticketUrl(ticketId: string): string {
    return `${this.config.get('APP_URL').replace(/\/$/, '')}/tickets/${ticketId}`;
  }

  /**
   * The email twin of an in-app notification. queueEmail() is a no-op when
   * email is off or the template is disabled, and never throws, so the
   * in-app notification is unaffected.
   */
  private async emailUsers(
    userIds: (string | null | undefined)[],
    templateKey: string,
    variables: TemplateVariables,
    ticketId: string,
  ): Promise<void> {
    const ids = [...new Set(userIds.filter((id): id is string => !!id))];
    if (!ids.length) return;
    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      select: { email: true },
    });
    for (const row of rows) {
      if (!row.email) continue;
      await this.email.queueEmail({ to: row.email, templateKey, variables, ticketId });
    }
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
        await this.escalationRecipients(),
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
        if (after.engineerId) {
          const engineer = await this.prisma.user.findUnique({
            where: { id: after.engineerId },
            select: { name: true },
          });
          await this.emailUsers(
            [after.engineerId],
            'ticket.assigned',
            {
              assigneeName: engineer?.name ?? 'there',
              ticketNumber: after.number,
              ticketTitle: after.title,
              ticketUrl: this.ticketUrl(after.id),
            },
            after.id,
          );
        }
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
      [ticket.engineerId, ticket.areaManagerId, ...(await this.escalationRecipients())],
      `${ticket.number}: ${what} time missed`,
    );
    await this.emailUsers(
      [ticket.engineerId, ticket.areaManagerId, ...(await this.escalationRecipients())],
      'sla.breached',
      {
        ticketNumber: ticket.number,
        ticketTitle: ticket.title,
        ticketUrl: this.ticketUrl(ticket.id),
      },
      ticket.id,
    );
  }

  /** A visit was submitted: the area manager (or service managers) hear about it. */
  async visitSubmitted(ticket: NotifyTicket, visitNumber: number, actor: Actor): Promise<void> {
    await this.send(
      'VISIT_SUBMITTED',
      ticket,
      await this.managersFor(ticket),
      `Visit ${visitNumber} submitted on ${ticket.number}`,
      actor,
    );
  }

  /**
   * An escalation timer fired: the level's recipients hear about it. The caller
   * computed the recipients (area manager or an admin-chosen role).
   */
  async escalated(ticket: NotifyTicket, level: number, userIds: string[]): Promise<void> {
    await this.send(
      'TICKET_ESCALATED',
      ticket,
      userIds,
      `Escalated to level ${level}: ${ticket.number}`,
      undefined,
      `The assigned engineer did not respond in time. ${ticket.title}`,
    );
  }

  /**
   * A quotation expired: customer support (everyone who can price work) hears
   * about it, so they can follow up or re-quote.
   */
  async quotationExpired(
    ticket: Pick<NotifyTicket, 'id' | 'number' | 'title'>,
    quotationNumber: string,
  ): Promise<void> {
    const rows = await this.prisma.user.findMany({
      where: { role: rolesWith('quotations.edit'), status: 'ACTIVE' },
      select: { id: true },
    });
    await this.send(
      'QUOTATION_EXPIRED',
      ticket as NotifyTicket,
      rows.map((r) => r.id),
      `Quotation ${quotationNumber} expired on ${ticket.number}`,
    );
  }
}
