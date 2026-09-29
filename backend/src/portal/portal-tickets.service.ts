import { HttpStatus, Injectable } from '@nestjs/common';
import { TicketChannel, TicketEventType, type Prisma } from '@prisma/client';
import { AuditService } from '../core/audit/audit.service';
import { AppException, validationFailed } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import type { ClientInfo } from '../auth/auth.types';
import { TicketsService } from '../tickets/tickets.service';
import type { CreateTicketDto } from '../tickets/dto';
import type { CustomerIdentity } from './portal.guard';
import {
  equipmentName,
  portalActor,
  portalNotFound,
  visibleToCustomer,
} from './customer-visibility';
import type { PortalCreateTicketDto } from './dto';

/** Timeline event types a customer may see. Internal NOTE/ATTACHMENT/SLA events stay hidden. */
const CUSTOMER_TIMELINE_TYPES: TicketEventType[] = [
  'CREATED',
  'STAGE_CHANGED',
  'ASSIGNED',
  'REOPENED',
  'APPROVAL',
];

const ticketNotFound = () =>
  portalNotFound(
    'TICKET_NOT_FOUND',
    "That ticket doesn't exist, or it isn't one of yours.",
  );

const humanizeStage = (stage: string | null | undefined) =>
  stage ? stage.charAt(0) + stage.slice(1).toLowerCase().replace(/_/g, ' ') : 'unknown';

interface ApprovalData {
  outcome?: string;
  contactName?: string;
  reason?: string;
  poNumber?: string;
}

@Injectable()
export class PortalTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Raises a ticket for the customer's own equipment through the same
   * synthetic-actor seam the partner API uses: createdById null, the contact
   * identified in the audit summary.
   */
  async create(
    identity: CustomerIdentity,
    dto: PortalCreateTicketDto,
    client: ClientInfo,
  ): Promise<{ number: string }> {
    if (dto.equipmentId) {
      const equipment = await this.prisma.equipment.findFirst({
        where: { id: dto.equipmentId, customerId: identity.customerId, active: true },
        select: { id: true },
      });
      if (!equipment) throw ticketNotFoundFor('equipmentId');
    }

    const serviceTypeId = dto.serviceTypeId ?? (await this.defaultServiceTypeId());

    const createDto: CreateTicketDto = {
      customerId: identity.customerId,
      equipmentId: dto.equipmentId,
      serviceTypeId,
      contactId: identity.contactId,
      channel: TicketChannel.PORTAL,
      title: dto.title.trim(),
      description: dto.description?.trim() || undefined,
    };

    const created = await this.tickets.create(portalActor(identity), createDto, {
      createdById: null,
    });

    await this.audit.record({
      actorId: null,
      action: 'portal.ticket_created',
      entityType: 'Ticket',
      entityId: created.id,
      summary: `Ticket ${created.number} raised by ${identity.contactName} (${identity.email}) via the customer portal.`,
      ip: client.ip,
      requestId: client.requestId,
    });

    return { number: created.number };
  }

  async list(identity: CustomerIdentity, page: number, pageSize: number) {
    const where: Prisma.TicketWhereInput = visibleToCustomer(identity.customerId);
    const [total, items] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          number: true,
          title: true,
          stage: true,
          priority: true,
          slaDueAt: true,
          createdAt: true,
        },
      }),
    ]);
    return { items, page, pageSize, total };
  }

  async detail(identity: CustomerIdentity, number: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { number, ...visibleToCustomer(identity.customerId) },
      select: {
        id: true,
        number: true,
        title: true,
        description: true,
        stage: true,
        priority: true,
        slaDueAt: true,
        createdAt: true,
        equipment: { select: { id: true, itemName: true, serialNo: true } },
        events: {
          where: { type: { in: CUSTOMER_TIMELINE_TYPES } },
          orderBy: { createdAt: 'asc' },
          select: {
            type: true,
            toStage: true,
            createdAt: true,
            data: true,
            actor: { select: { name: true } },
          },
        },
        csatTokens: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { expiresAt: true, response: { select: { id: true } } },
        },
      },
    });
    if (!ticket) throw ticketNotFound();

    const attachments = await this.prisma.ticketAttachment.findMany({
      // Staff uploads carry uploadedById; only customer-origin files are shown.
      where: { ticketId: ticket.id, uploadedById: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fileName: true },
    });

    const now = new Date();
    const csatToken = ticket.csatTokens[0];
    const csatState: 'none' | 'pending' | 'answered' = !csatToken
      ? 'none'
      : csatToken.response
        ? 'answered'
        : csatToken.expiresAt && csatToken.expiresAt <= now
          ? 'none'
          : 'pending';

    return {
      number: ticket.number,
      title: ticket.title,
      description: ticket.description,
      stage: ticket.stage,
      priority: ticket.priority,
      slaDueAt: ticket.slaDueAt,
      createdAt: ticket.createdAt,
      equipment: ticket.equipment
        ? { id: ticket.equipment.id, name: equipmentName(ticket.equipment) }
        : null,
      timeline: ticket.events.map((event) => ({
        type: event.type,
        at: event.createdAt,
        summary: eventSummary(event),
      })),
      attachments: attachments.map((a) => ({ id: a.id, filename: a.fileName })),
      csat: { state: csatState },
    };
  }

  private async defaultServiceTypeId(): Promise<string> {
    const fallback = await this.prisma.serviceType.findFirst({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    if (!fallback) {
      throw new AppException(
        'SERVICE_TYPE_UNAVAILABLE',
        'No service type is available right now. Contact support to log your ticket.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return fallback.id;
  }
}

const ticketNotFoundFor = (field: string) =>
  validationFailed([{ field, message: "Choose one of your customer's machines." }]);

function eventSummary(event: {
  type: TicketEventType;
  toStage: string | null;
  data: Prisma.JsonValue;
  actor: { name: string } | null;
}): string {
  switch (event.type) {
    case 'STAGE_CHANGED':
      return `Stage changed to ${humanizeStage(event.toStage)}`;
    case 'ASSIGNED':
      return `Assigned to ${event.actor?.name ?? 'an engineer'}`;
    case 'REOPENED':
      return 'Ticket reopened';
    case 'APPROVAL': {
      const data = (event.data ?? {}) as ApprovalData;
      const who = data.contactName ?? 'the customer';
      return data.outcome === 'rejected'
        ? `Quotation rejected by ${who}`
        : `Quotation approved by ${who}`;
    }
    case 'CREATED':
    default:
      return 'Ticket created';
  }
}
