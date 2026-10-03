import { HttpStatus, Injectable } from '@nestjs/common';
import { NotificationType, type QuotationStatus } from '@prisma/client';
import { AuditService } from '../core/audit/audit.service';
import { AppException, validationFailed } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { ClientInfo } from '../auth/auth.types';
import type { CustomerIdentity } from './portal.guard';
import { portalNotFound } from './customer-visibility';
import type { PortalApproveQuotationDto, PortalRejectQuotationDto } from './dto';

/** What a customer may act on: sent offers, and offers whose PO has arrived. */
const CUSTOMER_VISIBLE_STATUSES: QuotationStatus[] = ['SENT', 'PO_RECEIVED'];

const quotationNotFound = () =>
  portalNotFound(
    'QUOTATION_NOT_FOUND',
    "That quotation doesn't exist, or it isn't one of yours.",
  );

const notApprovable = (status: QuotationStatus) =>
  new AppException(
    'QUOTATION_NOT_APPROVABLE',
    `Only sent quotations can be approved or rejected; this one is ${status.toLowerCase()}.`,
    HttpStatus.CONFLICT,
  );

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ScopedQuotation = {
  id: string;
  number: string;
  status: QuotationStatus;
  ticket: { id: string; number: string; engineerId: string | null; areaManagerId: string | null };
};

/**
 * Customer approval of quotations. Approval stamps approvedByCustomerAt and an
 * APPROVAL ticket event; it never moves status by itself. When the customer
 * supplies a PO number, the quotation moves SENT → PO_RECEIVED inline —
 * deliberately not via QuotationsService.recordPo(): that method audits with
 * actorId = the caller's user id, and the synthetic `customer:<id>` actor is
 * not a User row, so the FK would fail. The audit here uses actorId null with
 * the contact named in the summary, matching every other portal/system write.
 */
@Injectable()
export class PortalQuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(identity: CustomerIdentity, ticketNumber?: string) {
    const items = await this.prisma.quotation.findMany({
      where: {
        status: { in: CUSTOMER_VISIBLE_STATUSES },
        ticket: {
          customerId: identity.customerId,
          ...(ticketNumber ? { number: ticketNumber } : {}),
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        number: true,
        status: true,
        validUntil: true,
        approvedByCustomerAt: true,
        lines: { select: { quantity: true, rate: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    return { items };
  }

  async approve(
    identity: CustomerIdentity,
    id: string,
    dto: PortalApproveQuotationDto,
    client: ClientInfo,
  ): Promise<{ ok: true; status: QuotationStatus }> {
    const quotation = await this.scoped(id, identity.customerId);
    if (quotation.status !== 'SENT') throw notApprovable(quotation.status);
    const poNumber = dto.poNumber?.trim() || null;
    const poDate = dto.poDate?.trim() || null;
    if (poDate && !DATE_RE.test(poDate)) {
      throw validationFailed([{ field: 'poDate', message: 'Use YYYY-MM-DD.' }]);
    }

    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        // Status guard: if staff revised/cancelled the quotation between the
        // scoped read above and this write, the update misses and the whole
        // approval rolls back instead of stamping a dead quotation.
        await tx.quotation.update({
          where: { id: quotation.id, status: 'SENT' },
          data: { approvedByCustomerAt: now },
        });
      await tx.ticketEvent.create({
        data: {
          ticketId: quotation.ticket.id,
          type: 'APPROVAL',
          actorId: null,
          data: {
            outcome: 'approved',
            contactId: identity.contactId,
            contactName: identity.contactName,
            quotationNumber: quotation.number,
            ...(poNumber ? { poNumber } : {}),
          },
        },
      });
      await this.audit.record(
        {
          actorId: null,
          action: 'portal.quotation_approved',
          entityType: 'Quotation',
          entityId: quotation.id,
          summary: `Quotation ${quotation.number} (${quotation.ticket.number}) approved by ${identity.contactName} (${identity.email}) via the customer portal${poNumber ? ` with PO ${poNumber}` : ''}.`,
          ip: client.ip,
          requestId: client.requestId,
        },
        tx,
      );
      });
    } catch (error: unknown) {
      if ((error as { code?: string })?.code === 'P2025') {
        // The status guard missed: staff revised or cancelled the quotation
        // between the scoped read and this write. Nothing was stamped.
        throw new AppException(
          'QUOTATION_NOT_APPROVABLE',
          'This quotation changed while you were approving it. Please refresh and try again.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    let status: QuotationStatus = 'SENT';
    if (poNumber) {
      status = await this.recordPo(quotation, poNumber, poDate, identity, client);
    }

    await this.notifications.notify({
      userIds: [quotation.ticket.engineerId, quotation.ticket.areaManagerId],
      type: NotificationType.TICKET_NEW,
      title: `Quotation ${quotation.number} approved by ${identity.contactName}`,
      body: `${quotation.ticket.number}: the customer approved ${quotation.number}${poNumber ? ` and supplied PO ${poNumber}` : ' (no PO yet — record it in ERPTick)'}.`,
      ticketId: quotation.ticket.id,
    });

    return { ok: true, status };
  }

  async reject(
    identity: CustomerIdentity,
    id: string,
    dto: PortalRejectQuotationDto,
    client: ClientInfo,
  ): Promise<{ ok: true }> {
    const quotation = await this.scoped(id, identity.customerId);
    if (quotation.status !== 'SENT') throw notApprovable(quotation.status);
    const reason = dto.reason?.trim() || null;

    await this.prisma.$transaction(async (tx) => {
      await tx.ticketEvent.create({
        data: {
          ticketId: quotation.ticket.id,
          type: 'APPROVAL',
          actorId: null,
          data: {
            outcome: 'rejected',
            contactId: identity.contactId,
            contactName: identity.contactName,
            quotationNumber: quotation.number,
            ...(reason ? { reason } : {}),
          },
        },
      });
      await this.audit.record(
        {
          actorId: null,
          action: 'portal.quotation_rejected',
          entityType: 'Quotation',
          entityId: quotation.id,
          summary: `Quotation ${quotation.number} (${quotation.ticket.number}) rejected by ${identity.contactName} (${identity.email}) via the customer portal${reason ? `: ${reason}` : ''}.`,
          ip: client.ip,
          requestId: client.requestId,
        },
        tx,
      );
    });

    await this.notifications.notify({
      userIds: [quotation.ticket.engineerId, quotation.ticket.areaManagerId],
      type: NotificationType.TICKET_NEW,
      title: `Quotation ${quotation.number} rejected by ${identity.contactName}`,
      body: `${quotation.ticket.number}: the customer rejected ${quotation.number}${reason ? ` — ${reason}` : ''}.`,
      ticketId: quotation.ticket.id,
    });

    return { ok: true };
  }

  private async scoped(id: string, customerId: string): Promise<ScopedQuotation> {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, ticket: { customerId } },
      select: {
        id: true,
        number: true,
        status: true,
        ticket: {
          select: { id: true, number: true, engineerId: true, areaManagerId: true },
        },
      },
    });
    if (!quotation) throw quotationNotFound();
    return quotation;
  }

  /**
   * Staff recordPo() semantics, minus the user-actor audit: an atomic
   * SENT → PO_RECEIVED move (the where clause is the idempotency guard — a
   * concurrent recording loses with P2025, reported as 409). The quotation
   * expiry job re-reads status and skips anything not SENT, so no explicit
   * expiry cancel is needed here.
   */
  private async recordPo(
    quotation: ScopedQuotation,
    poNumber: string,
    poDate: string | null,
    identity: CustomerIdentity,
    client: ClientInfo,
  ): Promise<QuotationStatus> {
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.quotation.update({
          where: { id: quotation.id, status: 'SENT' },
          data: {
            status: 'PO_RECEIVED',
            poNumber,
            poDate: poDate ? new Date(`${poDate}T00:00:00Z`) : null,
            poReceivedAt: now,
            version: { increment: 1 },
          },
        });
        await this.audit.record(
          {
            actorId: null,
            action: 'portal.quotation_po',
            entityType: 'Quotation',
            entityId: quotation.id,
            summary: `Recorded PO ${poNumber} against quotation ${quotation.number} (${quotation.ticket.number}), supplied by ${identity.contactName} via the customer portal.`,
            ip: client.ip,
            requestId: client.requestId,
          },
          tx,
        );
      });
    } catch (error: unknown) {
      if ((error as { code?: string })?.code === 'P2025') {
        throw new AppException(
          'QUOTATION_PO_NOT_ALLOWED',
          'A purchase order was already recorded for this quotation.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
    return 'PO_RECEIVED';
  }
}
