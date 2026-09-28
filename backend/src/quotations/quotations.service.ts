import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from '../core/audit/audit.service';
import { AppException, validationFailed } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { assertVersion } from '../service-rules/common';
import { AppSettingsService } from '../demo/app-settings.service';
import { TicketsService, visibleTo } from '../tickets/tickets.service';
import {
  AddLineDto,
  CreateQuotationDto,
  ListQuotationsDto,
  RecordPoDto,
  UpdateLineDto,
  UpdateQuotationDto,
} from './dto';
import { QuotationEvents } from './quotation-events';
import { QuotationExpiryService } from './quotation-expiry.service';

export const QUOTATION_NUMBER_PREFIX = 'QT';

const quotationDetail = {
  id: true,
  ticketId: true,
  number: true,
  status: true,
  discountPercent: true,
  validUntil: true,
  notes: true,
  sentAt: true,
  poNumber: true,
  poDate: true,
  poReceivedAt: true,
  revisesId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface TotalsLine {
  quantity: Prisma.Decimal | number | string;
  rate: Prisma.Decimal | number | string;
}

export interface QuotationTotals {
  currency: string;
  gstRatePercent: number;
  lineCount: number;
  /** Two-decimal strings; totals are computed, never stored. */
  subtotal: string;
  discount: string;
  taxable: string;
  gst: string;
  total: string;
}

/**
 * Pure totals math: subtotal = Σ qty × rate, then the optional total-level
 * discount, then the single company GST rate on the discounted amount.
 */
export function totalsFor(
  lines: TotalsLine[],
  discountPercent: Prisma.Decimal | number | string | null | undefined,
  gstRatePercent: number,
  currency: string,
): QuotationTotals {
  const dec = (v: Prisma.Decimal | number | string | null | undefined) =>
    new Prisma.Decimal(v ?? 0);
  const subtotal = lines.reduce(
    (sum, l) => sum.add(dec(l.quantity).mul(dec(l.rate))),
    new Prisma.Decimal(0),
  );
  const discount = subtotal.mul(dec(discountPercent).div(100));
  const taxable = subtotal.sub(discount);
  const gst = taxable.mul(new Prisma.Decimal(gstRatePercent).div(100));
  const total = taxable.add(gst);
  const money = (d: Prisma.Decimal) => d.toFixed(2);
  return {
    currency,
    gstRatePercent,
    lineCount: lines.length,
    subtotal: money(subtotal),
    discount: money(discount),
    taxable: money(taxable),
    gst: money(gst),
    total: money(total),
  };
}

type TicketRef = {
  id: string;
  number: string;
  title: string;
  coverage: string;
};

@Injectable()
export class QuotationsService {
  private readonly logger = new Logger(QuotationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly settings: AppSettingsService,
    private readonly expiry: QuotationExpiryService,
    private readonly events: QuotationEvents,
    private readonly audit: AuditService,
  ) {}

  /** The ticket, or 404 when it doesn't exist or the user can't see it. */
  private async ticketFor(user: AuthUser, ticketId: string): Promise<TicketRef> {
    const id = await this.tickets.visibleId(user, ticketId);
    return this.prisma.ticket.findUniqueOrThrow({
      where: { id },
      select: { id: true, number: true, title: true, coverage: true },
    });
  }

  /** Quotations exist only on chargeable tickets: AMC/warranty work is covered. */
  private assertChargeable(ticket: TicketRef): void {
    if (ticket.coverage !== 'CHARGEABLE') {
      throw new AppException(
        'QUOTATION_NOT_CHARGEABLE',
        `Ticket ${ticket.number} is covered (${ticket.coverage.toLowerCase()}); quotations are only for chargeable work.`,
        HttpStatus.CONFLICT,
      );
    }
  }

  /** The valid-until date must be after today in the company time zone. */
  private async assertFutureDate(validUntil: string): Promise<void> {
    const { timezone } = await this.settings.company();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
    if (validUntil <= today) {
      throw validationFailed([
        { field: 'validUntil', message: 'Pick a future date for the offer to stay valid.' },
      ]);
    }
  }

  /** Next QT-26-000123 number, inside the caller's transaction. */
  private async nextNumber(tx: Prisma.TransactionClient, now: Date): Promise<string> {
    const { timezone } = await this.settings.company();
    const year = Number(
      new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric' }).format(now),
    );
    const counter = await tx.quotationCounter.upsert({
      where: { year },
      create: { year, last: 1 },
      update: { last: { increment: 1 } },
    });
    return `${QUOTATION_NUMBER_PREFIX}-${String(year % 100).padStart(2, '0')}-${String(counter.last).padStart(6, '0')}`;
  }

  private async withTotals<T extends { lines: TotalsLine[]; discountPercent: unknown }>(
    quotation: T,
  ): Promise<T & { totals: QuotationTotals }> {
    const company = await this.settings.company();
    return {
      ...quotation,
      totals: totalsFor(
        quotation.lines,
        quotation.discountPercent as Prisma.Decimal | null,
        company.gstRatePercent,
        company.currency,
      ),
    };
  }

  /** A quotation the user may change: visible ticket, still a draft. */
  private async loadDraft(user: AuthUser, id: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      include: {
        lines: { include: { item: { select: { id: true, itemCode: true, name: true, uom: true } } } },
        ticket: { select: { id: true, number: true, title: true } },
      },
    });
    if (!quotation) {
      throw new AppException(
        'QUOTATION_NOT_FOUND',
        'That quotation no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.tickets.visibleId(user, quotation.ticketId);
    if (quotation.status !== 'DRAFT') {
      throw new AppException(
        'QUOTATION_NOT_DRAFT',
        `Only draft quotations can be changed; this one is ${quotation.status.toLowerCase()}.`,
        HttpStatus.CONFLICT,
      );
    }
    return quotation;
  }

  async create(user: AuthUser, dto: CreateQuotationDto) {
    const ticket = await this.ticketFor(user, dto.ticketId);
    this.assertChargeable(ticket);
    await this.assertFutureDate(dto.validUntil);
    const now = new Date();
    const quotation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.quotation.create({
        data: {
          ticketId: ticket.id,
          number: await this.nextNumber(tx, now),
          validUntil: new Date(`${dto.validUntil}T00:00:00Z`),
          discountPercent:
            dto.discountPercent == null ? null : new Prisma.Decimal(dto.discountPercent),
          notes: dto.notes?.trim() || null,
          createdById: user.id,
        },
        select: { ...quotationDetail, lines: true },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'quotation.create',
          entityType: 'Quotation',
          entityId: created.id,
          summary: `Created quotation ${created.number} on ticket ${ticket.number}`,
        },
        tx,
      );
      return created;
    });
    return this.withTotals(quotation);
  }

  /** Quotations on one ticket, newest first. */
  async listForTicket(user: AuthUser, ticketId: string) {
    const id = await this.tickets.visibleId(user, ticketId);
    const quotations = await this.prisma.quotation.findMany({
      where: { ticketId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        ...quotationDetail,
        sentBy: { select: { name: true } },
        lines: { select: { quantity: true, rate: true } },
      },
    });
    return Promise.all(quotations.map((q) => this.withTotals(q)));
  }

  /** Every quotation on tickets the user may see, newest first, paginated. */
  async list(user: AuthUser, query: ListQuotationsDto) {
    const search = query.search?.trim();
    const match = (value: string) => ({ contains: value, mode: 'insensitive' }) as const;
    const where: Prisma.QuotationWhereInput = {
      AND: [
        // Quotations inherit the ticket's visibility; hidden tickets are 404 elsewhere.
        { ticket: visibleTo(user) },
        ...(search
          ? [
              {
                OR: [
                  { number: match(search) },
                  { ticket: { number: match(search) } },
                  { ticket: { customer: { name: match(search) } } },
                ],
              },
            ]
          : []),
        ...(query.status ? [{ status: query.status }] : []),
      ],
    };
    const total = await this.prisma.quotation.count({ where });
    const quotations = await this.prisma.quotation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        ...quotationDetail,
        sentBy: { select: { name: true } },
        lines: { select: { quantity: true, rate: true } },
      },
    });
    const data = await Promise.all(quotations.map((q) => this.withTotals(q)));
    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  async get(user: AuthUser, id: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      select: {
        ...quotationDetail,
        lines: {
          include: { item: { select: { id: true, itemCode: true, name: true, uom: true } } },
          orderBy: { createdAt: 'asc' },
        },
        sentBy: { select: { name: true } },
        createdBy: { select: { name: true } },
        revises: { select: { id: true, number: true } },
        ticket: { select: { id: true, number: true, title: true } },
      },
    });
    if (!quotation) {
      throw new AppException(
        'QUOTATION_NOT_FOUND',
        'That quotation no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.tickets.visibleId(user, quotation.ticketId);
    return this.withTotals(quotation);
  }

  async update(user: AuthUser, id: string, dto: UpdateQuotationDto) {
    const quotation = await this.loadDraft(user, id);
    assertVersion(quotation.version, dto.version, 'quotation');
    if (dto.validUntil) await this.assertFutureDate(dto.validUntil);
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.quotation.update({
        where: { id },
        data: {
          validUntil: dto.validUntil ? new Date(`${dto.validUntil}T00:00:00Z`) : undefined,
          discountPercent:
            dto.discountPercent === undefined
              ? undefined
              : dto.discountPercent == null
                ? null
                : new Prisma.Decimal(dto.discountPercent),
          notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
          version: { increment: 1 },
        },
        select: { ...quotationDetail, lines: { select: { quantity: true, rate: true } } },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'quotation.update',
          entityType: 'Quotation',
          entityId: id,
          summary: `Edited draft quotation ${quotation.number} on ticket ${quotation.ticket.number}`,
        },
        tx,
      );
      return next;
    });
    return this.withTotals(updated);
  }

  /** Drafts that were never sent can be deleted; lines cascade. */
  async remove(user: AuthUser, id: string) {
    const quotation = await this.loadDraft(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.quotation.delete({ where: { id } });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'quotation.delete',
          entityType: 'Quotation',
          entityId: id,
          summary: `Deleted draft quotation ${quotation.number} on ticket ${quotation.ticket.number}`,
        },
        tx,
      );
    });
  }

  async addLine(user: AuthUser, id: string, dto: AddLineDto) {
    const quotation = await this.loadDraft(user, id);
    const item = await this.prisma.item.findFirst({
      where: { id: dto.itemId, active: true },
      select: { id: true, itemCode: true, name: true, uom: true },
    });
    if (!item) {
      throw new AppException('ITEM_NOT_FOUND', 'That item does not exist.', HttpStatus.NOT_FOUND);
    }
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.quotationLine.create({
        data: {
          quotationId: id,
          itemId: item.id,
          quantity: new Prisma.Decimal(dto.quantity),
          rate: new Prisma.Decimal(dto.rate),
        },
        include: { item: { select: { id: true, itemCode: true, name: true, uom: true } } },
      });
      await tx.quotation.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'quotation.line.add',
          entityType: 'Quotation',
          entityId: id,
          summary: `Added ${dto.quantity} × ${item.name} to quotation ${quotation.number}`,
        },
        tx,
      );
      return line;
    });
  }

  async updateLine(user: AuthUser, id: string, lineId: string, dto: UpdateLineDto) {
    const quotation = await this.loadDraft(user, id);
    assertVersion(quotation.version, dto.version, 'quotation');
    const line = await this.prisma.quotationLine.findFirst({
      where: { id: lineId, quotationId: id },
      include: { item: { select: { name: true } } },
    });
    if (!line) {
      throw new AppException(
        'QUOTATION_LINE_NOT_FOUND',
        'That line no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.quotationLine.update({
        where: { id: lineId },
        data: {
          quantity: new Prisma.Decimal(dto.quantity),
          rate: new Prisma.Decimal(dto.rate),
        },
        include: { item: { select: { id: true, itemCode: true, name: true, uom: true } } },
      });
      await tx.quotation.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'quotation.line.update',
          entityType: 'Quotation',
          entityId: id,
          summary: `Updated ${line.item.name} on quotation ${quotation.number}`,
          changes: {
            quantity: { from: line.quantity.toString(), to: String(dto.quantity) },
            rate: { from: line.rate.toString(), to: String(dto.rate) },
          },
        },
        tx,
      );
      return updated;
    });
  }

  async removeLine(user: AuthUser, id: string, lineId: string) {
    const quotation = await this.loadDraft(user, id);
    const line = await this.prisma.quotationLine.findFirst({
      where: { id: lineId, quotationId: id },
      include: { item: { select: { name: true } } },
    });
    if (!line) {
      throw new AppException(
        'QUOTATION_LINE_NOT_FOUND',
        'That line no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.quotationLine.delete({ where: { id: lineId } });
      await tx.quotation.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'quotation.line.remove',
          entityType: 'Quotation',
          entityId: id,
          summary: `Removed ${line.item.name} from quotation ${quotation.number}`,
        },
        tx,
      );
    });
  }

  /**
   * Sending locks the quotation and starts its validity clock. Idempotent:
   * sending twice returns 409, so a retried tap can never send twice.
   * (No email yet — session 12; the printable view is the handover for now.)
   */
  async send(user: AuthUser, id: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      include: {
        lines: { select: { quantity: true, rate: true } },
        ticket: { select: { id: true, number: true, title: true } },
      },
    });
    if (!quotation) {
      throw new AppException(
        'QUOTATION_NOT_FOUND',
        'That quotation no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.tickets.visibleId(user, quotation.ticketId);
    const sent = await this.prisma.$transaction(async (tx) => {
      if (quotation.status !== 'DRAFT') {
        throw new AppException(
          'QUOTATION_NOT_DRAFT',
          `This quotation is already ${quotation.status.toLowerCase()}.`,
          HttpStatus.CONFLICT,
        );
      }
      if (quotation.lines.length === 0) {
        throw new AppException(
          'QUOTATION_EMPTY',
          'Add at least one line before sending the quotation.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      // The status guard makes concurrent sends idempotent: only one wins.
      const next = await tx.quotation
        .update({
          where: { id, status: 'DRAFT' },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            sentById: user.id,
            version: { increment: 1 },
          },
          select: { ...quotationDetail, lines: { select: { quantity: true, rate: true } } },
        })
        .catch((error: { code?: string }) => {
          if (error?.code === 'P2025') {
            throw new AppException(
              'QUOTATION_NOT_DRAFT',
              'This quotation is already sent.',
              HttpStatus.CONFLICT,
            );
          }
          throw error;
        });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'quotation.send',
          entityType: 'Quotation',
          entityId: id,
          summary: `Sent quotation ${quotation.number} on ticket ${quotation.ticket.number}`,
        },
        tx,
      );
      return next;
    });
    // After the commit: the expiry timer watches the valid-until date.
    await this.expiry.sync({ id, validUntil: sent.validUntil });
    await this.events.emitSent({
      quotationId: id,
      ticketId: quotation.ticketId,
      number: quotation.number,
      sentById: user.id,
      sentAt: sent.sentAt as Date,
    });
    return this.withTotals(sent);
  }

  /**
   * Records the customer's purchase order: the quotation is superseded and the
   * PO gate (when on) lets work start. Idempotent: 409 on a second recording.
   */
  async recordPo(user: AuthUser, id: string, dto: RecordPoDto) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      select: {
        id: true,
        ticketId: true,
        number: true,
        status: true,
        version: true,
        ticket: { select: { id: true, number: true, title: true } },
      },
    });
    if (!quotation) {
      throw new AppException(
        'QUOTATION_NOT_FOUND',
        'That quotation no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.tickets.visibleId(user, quotation.ticketId);
    assertVersion(quotation.version, dto.version, 'quotation');
    const received = await this.prisma.$transaction(async (tx) => {
      if (quotation.status !== 'SENT') {
        throw new AppException(
          'QUOTATION_PO_NOT_ALLOWED',
          `A purchase order can only be recorded on a sent quotation; this one is ${quotation.status.toLowerCase()}.`,
          HttpStatus.CONFLICT,
        );
      }
      // The status guard makes concurrent PO recordings idempotent: only one wins.
      const next = await tx.quotation
        .update({
          where: { id, status: 'SENT' },
          data: {
            status: 'PO_RECEIVED',
            poNumber: dto.poNumber.trim(),
            poDate: dto.poDate ? new Date(`${dto.poDate}T00:00:00Z`) : null,
            poReceivedAt: new Date(),
            version: { increment: 1 },
          },
          select: { ...quotationDetail, lines: { select: { quantity: true, rate: true } } },
        })
        .catch((error: { code?: string }) => {
          if (error?.code === 'P2025') {
            throw new AppException(
              'QUOTATION_PO_NOT_ALLOWED',
              'A purchase order was already recorded for this quotation.',
              HttpStatus.CONFLICT,
            );
          }
          throw error;
        });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'quotation.po',
          entityType: 'Quotation',
          entityId: id,
          summary: `Recorded PO ${dto.poNumber.trim()} against quotation ${quotation.number} (${quotation.ticket.number})`,
        },
        tx,
      );
      return next;
    });
    // After the commit: the offer can't expire any more.
    await this.expiry.cancel(id);
    await this.events.emitPoReceived({
      quotationId: id,
      ticketId: quotation.ticketId,
      number: quotation.number,
      poNumber: received.poNumber as string,
      recordedById: user.id,
      receivedAt: received.poReceivedAt as Date,
    });
    return this.withTotals(received);
  }

  /**
   * A revision supersedes the quotation: the old one becomes REVISED and a new
   * draft (with a new number) copies its lines for editing.
   */
  async revise(user: AuthUser, id: string, version: number) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      include: {
        lines: { select: { itemId: true, quantity: true, rate: true } },
        ticket: { select: { id: true, number: true, title: true, coverage: true } },
      },
    });
    if (!quotation) {
      throw new AppException(
        'QUOTATION_NOT_FOUND',
        'That quotation no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.tickets.visibleId(user, quotation.ticketId);
    assertVersion(quotation.version, version, 'quotation');
    const now = new Date();
    const revised = await this.prisma.$transaction(async (tx) => {
      if (quotation.status !== 'SENT' && quotation.status !== 'EXPIRED') {
        throw new AppException(
          'QUOTATION_REVISE_NOT_ALLOWED',
          `Only sent or expired quotations can be revised; this one is ${quotation.status.toLowerCase()}.`,
          HttpStatus.CONFLICT,
        );
      }
      await tx.quotation.update({
        where: { id },
        data: { status: 'REVISED', version: { increment: 1 } },
      });
      const created = await tx.quotation.create({
        data: {
          ticketId: quotation.ticketId,
          number: await this.nextNumber(tx, now),
          validUntil: quotation.validUntil,
          discountPercent: quotation.discountPercent,
          notes: quotation.notes,
          revisesId: id,
          createdById: user.id,
          lines: {
            create: quotation.lines.map((l) => ({
              itemId: l.itemId,
              quantity: l.quantity,
              rate: l.rate,
            })),
          },
        },
        select: {
          ...quotationDetail,
          lines: { include: { item: { select: { id: true, itemCode: true, name: true, uom: true } } } },
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'quotation.revise',
          entityType: 'Quotation',
          entityId: created.id,
          summary: `Revised quotation ${quotation.number} as ${created.number} on ticket ${quotation.ticket.number}`,
        },
        tx,
      );
      return created;
    });
    await this.expiry.cancel(id);
    return this.withTotals(revised);
  }

  /** Cancels a draft or sent quotation; the expiry timer is withdrawn. */
  async cancel(user: AuthUser, id: string, version: number) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      select: {
        id: true,
        ticketId: true,
        number: true,
        status: true,
        version: true,
        ticket: { select: { number: true } },
      },
    });
    if (!quotation) {
      throw new AppException(
        'QUOTATION_NOT_FOUND',
        'That quotation no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.tickets.visibleId(user, quotation.ticketId);
    assertVersion(quotation.version, version, 'quotation');
    const cancelled = await this.prisma.$transaction(async (tx) => {
      if (quotation.status !== 'DRAFT' && quotation.status !== 'SENT') {
        throw new AppException(
          'QUOTATION_CANCEL_NOT_ALLOWED',
          `This quotation is already ${quotation.status.toLowerCase()}.`,
          HttpStatus.CONFLICT,
        );
      }
      const next = await tx.quotation.update({
        where: { id },
        data: { status: 'CANCELLED', version: { increment: 1 } },
        select: { ...quotationDetail, lines: { select: { quantity: true, rate: true } } },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'quotation.cancel',
          entityType: 'Quotation',
          entityId: id,
          summary: `Cancelled quotation ${quotation.number} on ticket ${quotation.ticket.number}`,
        },
        tx,
      );
      return next;
    });
    await this.expiry.cancel(id);
    return this.withTotals(cancelled);
  }

  /**
   * The printable view: everything a paper/PDF quote needs — the company, the
   * customer, the lines and the computed totals. (Email arrives in session 12.)
   */
  async print(user: AuthUser, id: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      select: {
        ...quotationDetail,
        lines: {
          include: { item: { select: { id: true, itemCode: true, name: true, uom: true } } },
          orderBy: { createdAt: 'asc' },
        },
        sentBy: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!quotation) {
      throw new AppException(
        'QUOTATION_NOT_FOUND',
        'That quotation no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    }
    const ticket = await this.prisma.ticket.findUniqueOrThrow({
      where: { id: quotation.ticketId },
      select: {
        id: true,
        number: true,
        title: true,
        stage: true,
        customer: { select: { name: true, taxId: true, mobile: true, email: true } },
        site: { select: { title: true, line1: true, line2: true } },
      },
    });
    await this.tickets.visibleId(user, quotation.ticketId);
    const company = await this.settings.company();
    return {
      company: {
        name: company.name,
        timezone: company.timezone,
        currency: company.currency,
      },
      ticket: {
        number: ticket.number,
        title: ticket.title,
        stage: ticket.stage,
        customer: ticket.customer,
        site: ticket.site,
      },
      quotation: {
        ...quotation,
        totals: totalsFor(
          quotation.lines,
          quotation.discountPercent,
          company.gstRatePercent,
          company.currency,
        ),
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
