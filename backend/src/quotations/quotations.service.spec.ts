import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../core/http/app.exception';
import { findPoBlockingQuotation } from './po-gate';
import { QuotationExpiryService } from './quotation-expiry.service';
import { QuotationsService, totalsFor } from './quotations.service';

const user = {
  id: 'user-cs',
  name: 'Cara Support',
  permissions: ['quotations.read', 'quotations.create', 'quotations.edit', 'quotations.delete'],
} as AuthUser;

function mocks() {
  const quotation = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const quotationLine = {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const quotationCounter = { upsert: jest.fn() };
  // The service runs everything through $transaction; run the callback inline.
  const tx = { quotation, quotationLine, quotationCounter };
  const prisma = {
    quotation,
    quotationLine,
    quotationCounter,
    ticket: { findUniqueOrThrow: jest.fn() },
    item: { findFirst: jest.fn() },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const tickets = { visibleId: jest.fn().mockResolvedValue('ticket-1') };
  const settings = {
    company: jest.fn().mockResolvedValue({
      name: 'ERPTick',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      gstRatePercent: 18,
    }),
  };
  const expiry = { sync: jest.fn(), cancel: jest.fn() };
  const events = { emitSent: jest.fn(), emitPoReceived: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new QuotationsService(
    prisma as never,
    tickets as never,
    settings as never,
    expiry as never,
    events as never,
    audit as never,
  );
  return { prisma, tx, tickets, settings, expiry, events, audit, service };
}

const chargeableTicket = {
  id: 'ticket-1',
  number: 'ET-26-000101',
  title: 'Press breakdown',
  coverage: 'CHARGEABLE',
};

const amcTicket = { ...chargeableTicket, coverage: 'AMC' };

const draftQuotation = (patch: Record<string, unknown> = {}) => ({
  id: 'quote-1',
  ticketId: 'ticket-1',
  number: 'QT-26-000007',
  status: 'DRAFT',
  discountPercent: null,
  validUntil: new Date('2099-06-30T00:00:00Z'),
  notes: null,
  sentAt: null,
  poNumber: null,
  poDate: null,
  poReceivedAt: null,
  revisesId: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  lines: [],
  ticket: { id: 'ticket-1', number: 'ET-26-000101', title: 'Press breakdown' },
  ...patch,
});

/** Runs the promise, expecting it to reject with an AppException. */
async function appError(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    return error as AppException;
  }
  throw new Error('Expected the promise to reject, but it resolved.');
}

describe('totalsFor', () => {
  it('applies the discount before GST', () => {
    const totals = totalsFor(
      [
        { quantity: 2, rate: 100 },
        { quantity: 1.5, rate: 200 },
      ],
      10,
      18,
      'INR',
    );
    // Subtotal 500, discount 50, taxable 450, GST 81, total 531.
    expect(totals).toMatchObject({
      currency: 'INR',
      gstRatePercent: 18,
      lineCount: 2,
      subtotal: '500.00',
      discount: '50.00',
      taxable: '450.00',
      gst: '81.00',
      total: '531.00',
    });
  });

  it('handles no discount and Prisma Decimals', () => {
    const totals = totalsFor(
      [{ quantity: new Prisma.Decimal('3'), rate: new Prisma.Decimal('99.99') }],
      null,
      18,
      'INR',
    );
    expect(totals.subtotal).toBe('299.97');
    expect(totals.discount).toBe('0.00');
    expect(totals.gst).toBe('53.99');
    expect(totals.total).toBe('353.96');
  });

  it('is zero for no lines', () => {
    const totals = totalsFor([], 10, 18, 'INR');
    expect(totals).toMatchObject({ lineCount: 0, subtotal: '0.00', total: '0.00' });
  });
});

describe('QuotationsService', () => {
  describe('create', () => {
    it('numbers the quotation QT-YY-000NNN on a chargeable ticket', async () => {
      const { prisma, service } = mocks();
      prisma.ticket.findUniqueOrThrow.mockResolvedValue(chargeableTicket);
      prisma.quotationCounter.upsert.mockResolvedValue({ year: 2026, last: 7 });
      prisma.quotation.create.mockResolvedValue(draftQuotation({ lines: [] }));

      const quotation = await service.create(user, {
        ticketId: 'ticket-1',
        validUntil: '2099-06-30',
        discountPercent: 5,
        notes: '  Labour + spares  ',
      });

      expect(quotation.number).toMatch(/^QT-\d{2}-000007$/);
      expect(prisma.quotation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ticketId: 'ticket-1',
            notes: 'Labour + spares',
          }),
        }),
      );
    });

    it('refuses quotations on AMC/warranty tickets', async () => {
      const { prisma, service } = mocks();
      prisma.ticket.findUniqueOrThrow.mockResolvedValue(amcTicket);

      const error = await appError(
        service.create(user, { ticketId: 'ticket-1', validUntil: '2099-06-30' }),
      );

      expect(error.code).toBe('QUOTATION_NOT_CHARGEABLE');
      expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(prisma.quotation.create).not.toHaveBeenCalled();
    });

    it('requires a future valid-until date', async () => {
      const { prisma, service } = mocks();
      prisma.ticket.findUniqueOrThrow.mockResolvedValue(chargeableTicket);

      const error = await appError(
        service.create(user, { ticketId: 'ticket-1', validUntil: '2020-01-01' }),
      );

      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.fields).toEqual([
        { field: 'validUntil', message: expect.stringMatching(/future/) },
      ]);
      expect(prisma.quotation.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects stale versions', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(draftQuotation());

      const error = await appError(service.update(user, 'quote-1', { version: 2 }));

      expect(error.code).toBe('VERSION_CONFLICT');
      expect(prisma.quotation.update).not.toHaveBeenCalled();
    });

    it('refuses to change a sent quotation', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(draftQuotation({ status: 'SENT' }));

      const error = await appError(service.update(user, 'quote-1', { version: 1 }));

      expect(error.code).toBe('QUOTATION_NOT_DRAFT');
      expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    });

    it('clears the discount when sent null', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(draftQuotation());
      prisma.quotation.update.mockResolvedValue(draftQuotation());

      await service.update(user, 'quote-1', { version: 1, discountPercent: null });

      expect(prisma.quotation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ discountPercent: null }) }),
      );
    });
  });

  describe('lines', () => {
    it('refuses an unknown item', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(draftQuotation());
      prisma.item.findFirst.mockResolvedValue(null);

      const error = await appError(
        service.addLine(user, 'quote-1', { itemId: 'nope', quantity: 1, rate: 100 }),
      );

      expect(error.code).toBe('ITEM_NOT_FOUND');
      expect(prisma.quotationLine.create).not.toHaveBeenCalled();
    });

    it('bumps the quotation version when a line is added', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(draftQuotation());
      prisma.item.findFirst.mockResolvedValue({
        id: 'item-1',
        itemCode: 'BRG-01',
        name: 'Bearing',
        uom: 'NOS',
      });
      prisma.quotationLine.create.mockResolvedValue({ id: 'line-1' });

      await service.addLine(user, 'quote-1', { itemId: 'item-1', quantity: 2, rate: 450 });

      expect(prisma.quotation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { version: { increment: 1 } } }),
      );
    });
  });

  describe('send', () => {
    it('locks the quotation, schedules expiry and emits the event', async () => {
      const { prisma, expiry, events, service } = mocks();
      const lines = [{ quantity: 2, rate: 100 }];
      prisma.quotation.findUnique.mockResolvedValue(draftQuotation({ lines }));
      prisma.quotation.update.mockResolvedValue(
        draftQuotation({ status: 'SENT', lines, sentAt: new Date() }),
      );

      const sent = await service.send(user, 'quote-1');

      expect(sent.status).toBe('SENT');
      expect(prisma.quotation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SENT', sentById: user.id }),
        }),
      );
      expect(expiry.sync).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'quote-1' }),
      );
      expect(events.emitSent).toHaveBeenCalledWith(
        expect.objectContaining({ quotationId: 'quote-1', number: 'QT-26-000007' }),
      );
    });

    it('refuses an empty quotation', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(draftQuotation({ lines: [] }));

      const error = await appError(service.send(user, 'quote-1'));

      expect(error.code).toBe('QUOTATION_EMPTY');
      expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('is idempotent: a second send is a 409, not a duplicate', async () => {
      const { prisma, expiry, events, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(
        draftQuotation({ status: 'SENT', lines: [{ quantity: 1, rate: 1 }] }),
      );

      const error = await appError(service.send(user, 'quote-1'));

      expect(error.code).toBe('QUOTATION_NOT_DRAFT');
      expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(prisma.quotation.update).not.toHaveBeenCalled();
      expect(expiry.sync).not.toHaveBeenCalled();
      expect(events.emitSent).not.toHaveBeenCalled();
    });
  });

  describe('recordPo', () => {
    it('marks PO_RECEIVED, withdraws the expiry timer and emits the event', async () => {
      const { prisma, expiry, events, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(
        draftQuotation({ status: 'SENT', version: 3 }),
      );
      prisma.quotation.update.mockResolvedValue(
        draftQuotation({ status: 'PO_RECEIVED', poNumber: 'PO-42', poReceivedAt: new Date() }),
      );

      const received = await service.recordPo(user, 'quote-1', {
        poNumber: '  PO-42 ',
        poDate: '2099-06-01',
        version: 3,
      });

      expect(received.status).toBe('PO_RECEIVED');
      expect(prisma.quotation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PO_RECEIVED', poNumber: 'PO-42' }),
        }),
      );
      expect(expiry.cancel).toHaveBeenCalledWith('quote-1');
      expect(events.emitPoReceived).toHaveBeenCalledWith(
        expect.objectContaining({ quotationId: 'quote-1', poNumber: 'PO-42' }),
      );
    });

    it('is idempotent: a second PO recording is a 409', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(
        draftQuotation({ status: 'PO_RECEIVED', version: 4 }),
      );

      const error = await appError(
        service.recordPo(user, 'quote-1', { poNumber: 'PO-43', version: 4 }),
      );

      expect(error.code).toBe('QUOTATION_PO_NOT_ALLOWED');
      expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(prisma.quotation.update).not.toHaveBeenCalled();
    });

    it('refuses a PO on a draft', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(draftQuotation());

      const error = await appError(
        service.recordPo(user, 'quote-1', { poNumber: 'PO-43', version: 1 }),
      );

      expect(error.code).toBe('QUOTATION_PO_NOT_ALLOWED');
    });
  });

  describe('revise', () => {
    it('supersedes the sent quotation with a new draft copying its lines', async () => {
      const { prisma, expiry, service } = mocks();
      const lines = [{ itemId: 'item-1', quantity: new Prisma.Decimal(2), rate: new Prisma.Decimal(100) }];
      prisma.quotation.findUnique.mockResolvedValue(
        draftQuotation({ status: 'SENT', version: 5, lines }),
      );
      prisma.quotationCounter.upsert.mockResolvedValue({ year: 2026, last: 8 });
      prisma.quotation.create.mockResolvedValue(draftQuotation({ number: 'QT-26-000008' }));
      prisma.quotation.update.mockResolvedValue({});

      const revision = await service.revise(user, 'quote-1', 5);

      expect(prisma.quotation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REVISED' }) }),
      );
      expect(prisma.quotation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            revisesId: 'quote-1',
            lines: {
              create: [
                { itemId: 'item-1', quantity: lines[0].quantity, rate: lines[0].rate },
              ],
            },
          }),
        }),
      );
      expect(expiry.cancel).toHaveBeenCalledWith('quote-1');
      expect(revision.number).toBe('QT-26-000008');
    });

    it('refuses to revise a draft', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(draftQuotation());

      const error = await appError(service.revise(user, 'quote-1', 1));

      expect(error.code).toBe('QUOTATION_REVISE_NOT_ALLOWED');
      expect(prisma.quotation.create).not.toHaveBeenCalled();
    });

    it('guards the write with status+version (recordPo pattern)', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(
        draftQuotation({ status: 'SENT', version: 5, lines: [] }),
      );
      prisma.quotationCounter.upsert.mockResolvedValue({ year: 2026, last: 8 });
      prisma.quotation.create.mockResolvedValue(draftQuotation({ number: 'QT-26-000008' }));
      prisma.quotation.update.mockResolvedValue({});

      await service.revise(user, 'quote-1', 5);

      expect(prisma.quotation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'quote-1', status: 'SENT', version: 5 } }),
      );
    });

    it('SB-M5: a revise racing a PO recording fails cleanly, no orphaned PO', async () => {
      const { prisma, expiry, service } = mocks();
      // The attacker read SENT/v5; a PO landed (SENT -> PO_RECEIVED) before
      // the revise's write. The guarded update finds no row -> P2025.
      prisma.quotation.findUnique.mockResolvedValue(
        draftQuotation({ status: 'SENT', version: 5, lines: [] }),
      );
      const p2025 = Object.assign(new Error('Record not found'), { code: 'P2025' });
      prisma.quotation.update.mockRejectedValue(p2025);

      const error = await appError(service.revise(user, 'quote-1', 5));

      expect(error.code).toBe('QUOTATION_REVISE_NOT_ALLOWED');
      expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
      // The whole transaction rolls back: no new draft, no PO stranded.
      expect(prisma.quotation.create).not.toHaveBeenCalled();
      expect(expiry.cancel).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancels a sent quotation and withdraws its timer', async () => {
      const { prisma, expiry, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(
        draftQuotation({ status: 'SENT', version: 3 }),
      );
      prisma.quotation.update.mockResolvedValue(draftQuotation({ status: 'CANCELLED' }));

      const cancelled = await service.cancel(user, 'quote-1', 3);

      expect(cancelled.status).toBe('CANCELLED');
      expect(expiry.cancel).toHaveBeenCalledWith('quote-1');
    });

    it('refuses to cancel an expired quotation', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(
        draftQuotation({ status: 'EXPIRED', version: 3 }),
      );

      const error = await appError(service.cancel(user, 'quote-1', 3));

      expect(error.code).toBe('QUOTATION_CANCEL_NOT_ALLOWED');
    });

    it('guards the write with status+version (recordPo pattern)', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(
        draftQuotation({ status: 'SENT', version: 3 }),
      );
      prisma.quotation.update.mockResolvedValue(draftQuotation({ status: 'CANCELLED' }));

      await service.cancel(user, 'quote-1', 3);

      expect(prisma.quotation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'quote-1', status: 'SENT', version: 3 } }),
      );
    });

    it('SB-M5: a cancel racing a PO recording fails cleanly, no orphaned PO', async () => {
      const { prisma, expiry, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(
        draftQuotation({ status: 'SENT', version: 3 }),
      );
      const p2025 = Object.assign(new Error('Record not found'), { code: 'P2025' });
      prisma.quotation.update.mockRejectedValue(p2025);

      const error = await appError(service.cancel(user, 'quote-1', 3));

      expect(error.code).toBe('QUOTATION_CANCEL_NOT_ALLOWED');
      expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(expiry.cancel).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes a draft', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(draftQuotation());

      await service.remove(user, 'quote-1');

      expect(prisma.quotation.delete).toHaveBeenCalledWith({ where: { id: 'quote-1' } });
    });

    it('refuses to delete a sent quotation', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.findUnique.mockResolvedValue(draftQuotation({ status: 'SENT' }));

      const error = await appError(service.remove(user, 'quote-1'));

      expect(error.code).toBe('QUOTATION_NOT_DRAFT');
      expect(prisma.quotation.delete).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    const row = {
      id: 'quote-1',
      number: 'QT-26-000001',
      status: 'SENT',
      discountPercent: null,
      lines: [{ quantity: 2, rate: 100 }],
    };

    it('returns a page of quotations with computed totals', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.count.mockResolvedValue(2);
      prisma.quotation.findMany.mockResolvedValue([row]);

      const page = await service.list(user, { page: 1, pageSize: 25 });

      expect(page).toMatchObject({ page: 1, pageSize: 25, total: 2 });
      expect(page.data).toHaveLength(1);
      expect(page.data[0].totals.total).toBe('236.00');
      expect(prisma.quotation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 25 }),
      );
    });

    it('applies the status filter, search and pagination', async () => {
      const { prisma, service } = mocks();
      prisma.quotation.count.mockResolvedValue(0);
      prisma.quotation.findMany.mockResolvedValue([]);

      await service.list(user, { page: 2, pageSize: 10, status: 'SENT', search: 'acme' });

      expect(prisma.quotation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              { status: 'SENT' },
              expect.objectContaining({ OR: expect.any(Array) }),
            ]),
          }),
        }),
      );
    });
  });
});

describe('findPoBlockingQuotation', () => {
  const txFor = (rows: Record<string, unknown>[]) => ({
    quotation: { findMany: jest.fn().mockResolvedValue(rows) },
  });
  const q = (patch: Record<string, unknown>) => ({
    id: 'q1',
    number: 'QT-26-000007',
    status: 'SENT',
    sentAt: new Date('2026-09-01T10:00:00Z'),
    poNumber: null,
    revisesId: null,
    createdAt: new Date('2026-09-01T09:00:00Z'),
    ...patch,
  });

  it('returns the number of a SENT quotation waiting for a PO', async () => {
    const tx = txFor([q({})]);

    const blocker = await findPoBlockingQuotation(tx as never, 'ticket-1');

    expect(blocker).toBe('QT-26-000007');
    expect(tx.quotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ticketId: 'ticket-1' } }),
    );
  });

  it('returns null when nothing blocks', async () => {
    expect(await findPoBlockingQuotation(txFor([]) as never, 'ticket-1')).toBeNull();
    expect(
      await findPoBlockingQuotation(txFor([q({ status: 'PO_RECEIVED', poNumber: 'PO-1' })]) as never, 'ticket-1'),
    ).toBeNull();
  });

  it('SB-H1: a revised SENT quotation without a PO still blocks', async () => {
    const tx = txFor([
      q({ id: 'q1', number: 'QT-26-000007', status: 'REVISED' }),
      q({
        id: 'q2',
        number: 'QT-26-000008',
        status: 'DRAFT',
        sentAt: null,
        revisesId: 'q1',
        createdAt: new Date('2026-09-02T09:00:00Z'),
      }),
    ]);

    expect(await findPoBlockingQuotation(tx as never, 'ticket-1')).toBe('QT-26-000007');
  });

  it('SB-H1: a cancelled SENT quotation without a PO still blocks', async () => {
    const tx = txFor([q({ status: 'CANCELLED' })]);

    expect(await findPoBlockingQuotation(tx as never, 'ticket-1')).toBe('QT-26-000007');
  });

  it('does not block when the revision chain received a PO (legitimate flow)', async () => {
    const tx = txFor([
      q({ id: 'q1', number: 'QT-26-000007', status: 'REVISED' }),
      q({
        id: 'q2',
        number: 'QT-26-000008',
        status: 'PO_RECEIVED',
        poNumber: 'PO-99',
        revisesId: 'q1',
        createdAt: new Date('2026-09-02T09:00:00Z'),
      }),
    ]);

    expect(await findPoBlockingQuotation(tx as never, 'ticket-1')).toBeNull();
  });

  it('does not block a cancelled quotation when a later quote got the PO', async () => {
    const tx = txFor([
      q({ id: 'q1', number: 'QT-26-000007', status: 'CANCELLED' }),
      q({
        id: 'q3',
        number: 'QT-26-000009',
        status: 'PO_RECEIVED',
        poNumber: 'PO-100',
        createdAt: new Date('2026-09-03T09:00:00Z'),
      }),
    ]);

    expect(await findPoBlockingQuotation(tx as never, 'ticket-1')).toBeNull();
  });

  it('ignores quotations that were never sent', async () => {
    const tx = txFor([
      q({ status: 'CANCELLED', sentAt: null }),
      q({ id: 'q2', status: 'DRAFT', sentAt: null, createdAt: new Date('2026-09-02T09:00:00Z') }),
    ]);

    expect(await findPoBlockingQuotation(tx as never, 'ticket-1')).toBeNull();
  });
});

describe('QuotationExpiryService', () => {
  function expiryMocks() {
    const quotation = { findUnique: jest.fn(), update: jest.fn() };
    const tx = { quotation };
    const prisma = {
      quotation,
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const queues = { queue: jest.fn() };
    const queueMock = { remove: jest.fn().mockResolvedValue(1), add: jest.fn() };
    queues.queue.mockReturnValue(queueMock);
    const automations = { isEnabled: jest.fn().mockResolvedValue(false) };
    const notifier = { quotationExpired: jest.fn() };
    const audit = { record: jest.fn() };
    const service = new QuotationExpiryService(
      prisma as never,
      queues as never,
      automations as never,
      notifier as never,
      audit as never,
    );
    return { prisma, queues, queueMock, automations, notifier, audit, service };
  }

  const fire = (service: QuotationExpiryService, data: unknown) =>
    (service as unknown as { fire: (d: unknown) => Promise<string> }).fire(data);

  it('expires a sent quotation past its valid-until and notifies support', async () => {
    const { prisma, notifier, audit, service } = expiryMocks();
    prisma.quotation.findUnique.mockResolvedValue({
      id: 'quote-1',
      number: 'QT-26-000007',
      status: 'SENT',
      validUntil: new Date('2020-01-01T00:00:00Z'),
      ticket: { id: 'ticket-1', number: 'ET-26-000101', title: 'Press breakdown' },
    });

    const summary = await fire(service, {
      automationKey: 'quotation-expiry',
      trigger: 'EVENT',
      quotationId: 'quote-1',
      validUntil: new Date('2020-01-01T00:00:00Z').toISOString(),
    });

    expect(summary).toMatch(/expired/);
    expect(prisma.quotation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null, action: 'quotation.expired' }),
      expect.anything(),
    );
    expect(notifier.quotationExpired).toHaveBeenCalledWith(
      expect.objectContaining({ number: 'ET-26-000101' }),
      'QT-26-000007',
    );
  });

  it('skips when the quotation is no longer sent (stale timer)', async () => {
    const { prisma, notifier, service } = expiryMocks();
    prisma.quotation.findUnique.mockResolvedValue({
      id: 'quote-1',
      number: 'QT-26-000007',
      status: 'PO_RECEIVED',
      validUntil: new Date('2020-01-01T00:00:00Z'),
      ticket: { id: 'ticket-1', number: 'ET-26-000101', title: 'x' },
    });

    const summary = await fire(service, {
      quotationId: 'quote-1',
      validUntil: new Date('2020-01-01T00:00:00Z').toISOString(),
    });

    expect(summary).toMatch(/skipped/i);
    expect(prisma.quotation.update).not.toHaveBeenCalled();
    expect(notifier.quotationExpired).not.toHaveBeenCalled();
  });

  it('does not schedule the timer while the automation is switched off', async () => {
    const { queueMock, automations, service } = expiryMocks();
    automations.isEnabled.mockResolvedValue(false);

    await service.sync({ id: 'quote-1', validUntil: new Date('2099-01-01T00:00:00Z') });

    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('schedules the timer when the automation is switched on', async () => {
    const { queueMock, automations, service } = expiryMocks();
    automations.isEnabled.mockResolvedValue(true);

    await service.sync({ id: 'quote-1', validUntil: new Date('2099-01-01T00:00:00Z') });

    expect(queueMock.add).toHaveBeenCalledWith(
      'quotation-expiry',
      expect.objectContaining({ quotationId: 'quote-1' }),
      expect.objectContaining({ jobId: 'quotation-quote-1-expiry' }),
    );
  });
});
