import { HttpStatus } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../core/http/app.exception';
import { VisitsService } from './visits.service';

const engineer = {
  id: 'user-eng',
  name: 'Asha Engineer',
  permissions: ['visits.read', 'visits.create', 'visits.edit', 'visits.delete'],
} as AuthUser;

const manager = {
  id: 'user-mgr',
  name: 'Mira Manager',
  permissions: ['visits.read', 'visits.create', 'visits.edit', 'visits.delete', 'tickets.assign'],
} as AuthUser;

const stranger = {
  id: 'user-other',
  name: 'Sam Stranger',
  permissions: ['visits.read', 'visits.create', 'visits.edit'],
} as AuthUser;

function mocks() {  const visit = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  };
  const visitSpare = {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const visitPhoto = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  };
  // The service runs everything through $transaction; run the callback inline.
  // $executeRaw is the advisory lock for the one-draft-per-ticket invariant.
  const tx = { visit, visitSpare, visitPhoto, $executeRaw: jest.fn() };
  const prisma = {
    visit,
    visitSpare,
    visitPhoto,
    ticket: { findUniqueOrThrow: jest.fn() },
    item: { findFirst: jest.fn() },
    stockLevel: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const tickets = { visibleId: jest.fn().mockResolvedValue('ticket-1') };
  const notifier = { visitSubmitted: jest.fn() };
  const events = { emitSubmitted: jest.fn() };
  const storage = { save: jest.fn(), remove: jest.fn(), read: jest.fn() };
  const audit = { record: jest.fn() };
  const writebacks = { onVisitSubmitted: jest.fn() };
  const service = new VisitsService(
    prisma as never,
    tickets as never,
    notifier as never,
    events as never,
    storage as never,
    audit as never,
    writebacks as never,
  );
  return { prisma, tx, tickets, notifier, events, storage, audit, writebacks, service };
}

const ticketOnSite = {
  id: 'ticket-1',
  number: 'ET-26-000101',
  title: 'Press breakdown',
  stage: 'ON_SITE',
  engineerId: 'user-eng',
  areaManagerId: null,
};

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

describe('VisitsService', () => {
  describe('create', () => {
    it('starts visit 1 on a ticket with no visits', async () => {
      const { prisma, service } = mocks();
      prisma.ticket.findUniqueOrThrow.mockResolvedValue(ticketOnSite);
      prisma.visit.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prisma.visit.create.mockResolvedValue({ id: 'visit-1', visitNumber: 1 });

      const visit = await service.create(engineer, { ticketId: 'ticket-1' });

      expect(visit.visitNumber).toBe(1);
      expect(prisma.visit.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ visitNumber: 1 }) }),
      );
    });

    it('numbers the next visit after the last one', async () => {
      const { prisma, service } = mocks();
      prisma.ticket.findUniqueOrThrow.mockResolvedValue(ticketOnSite);
      prisma.visit.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ visitNumber: 2 });
      prisma.visit.create.mockResolvedValue({ id: 'visit-3', visitNumber: 3 });

      const visit = await service.create(engineer, { ticketId: 'ticket-1' });

      expect(visit.visitNumber).toBe(3);
    });

    it('refuses when the ticket is not on site or in progress', async () => {
      const { prisma, service } = mocks();
      prisma.ticket.findUniqueOrThrow.mockResolvedValue({ ...ticketOnSite, stage: 'NEW' });

      const err = await appError(service.create(engineer, { ticketId: 'ticket-1' }));
      expect(err.code).toBe('VISIT_STAGE_NOT_ALLOWED');
      expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
    });

    it('refuses when a draft visit is already open', async () => {
      const { prisma, service } = mocks();
      prisma.ticket.findUniqueOrThrow.mockResolvedValue(ticketOnSite);
      prisma.visit.findFirst.mockResolvedValueOnce({ id: 'visit-open' });

      await expect(service.create(engineer, { ticketId: 'ticket-1' })).rejects.toMatchObject({
        code: 'VISIT_DRAFT_EXISTS',
      } satisfies Partial<AppException>);
    });

    it('refuses when the user is neither the assignee nor a manager', async () => {
      const { prisma, service } = mocks();
      prisma.ticket.findUniqueOrThrow.mockResolvedValue(ticketOnSite);

      const err = await appError(service.create(stranger, { ticketId: 'ticket-1' }));
      expect(err.code).toBe('FORBIDDEN');
      expect(err.getStatus()).toBe(HttpStatus.FORBIDDEN);
    });

    it('lets a manager start a visit on an unassigned ticket', async () => {
      const { prisma, service } = mocks();
      prisma.ticket.findUniqueOrThrow.mockResolvedValue({ ...ticketOnSite, engineerId: null });
      prisma.visit.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prisma.visit.create.mockResolvedValue({ id: 'visit-1', visitNumber: 1 });

      await expect(service.create(manager, { ticketId: 'ticket-1' })).resolves.toMatchObject({
        visitNumber: 1,
      });
    });

    it('SB-L5: takes the per-ticket advisory lock before the draft check', async () => {
      const { prisma, tx, service } = mocks();
      prisma.ticket.findUniqueOrThrow.mockResolvedValue(ticketOnSite);
      prisma.visit.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prisma.visit.create.mockResolvedValue({ id: 'visit-1', visitNumber: 1 });

      await service.create(engineer, { ticketId: 'ticket-1' });

      const lockSql = String((tx.$executeRaw as jest.Mock).mock.calls[0][0][0]);
      expect(lockSql).toContain('pg_advisory_xact_lock');
      expect(lockSql).toContain('visit-draft:');
      // The ticket id is bound as a parameter, not interpolated into the SQL.
      expect((tx.$executeRaw as jest.Mock).mock.calls[0][1]).toBe('ticket-1');
      // Lock first, then the one-draft check: a concurrent create blocks on
      // the lock and sees the first create's draft after it commits.
      const lockOrder = (tx.$executeRaw as jest.Mock).mock.invocationCallOrder[0];
      const checkOrder = (prisma.visit.findFirst as jest.Mock).mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(checkOrder);
    });
  });

  describe('update', () => {
    const draft = {
      id: 'visit-1',
      ticketId: 'ticket-1',
      visitNumber: 1,
      status: 'DRAFT',
      version: 3,
      ticket: ticketOnSite,
    };

    it('rejects a stale version', async () => {
      const { prisma, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue(draft);

      await expect(
        service.update(engineer, 'visit-1', { workDone: 'Fixed it', version: 2 }),
      ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' } satisfies Partial<AppException>);
      expect(prisma.visit.update).not.toHaveBeenCalled();
    });

    it('bumps the version on success', async () => {
      const { prisma, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue(draft);
      prisma.visit.update.mockResolvedValue({ ...draft, version: 4 });

      await service.update(engineer, 'visit-1', { workDone: 'Fixed it', version: 3 });

      expect(prisma.visit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: { increment: 1 } }) }),
      );
    });

    it('refuses to edit a submitted visit', async () => {
      const { prisma, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue({ ...draft, status: 'SUBMITTED' });

      await expect(
        service.update(engineer, 'visit-1', { workDone: 'Late edit', version: 3 }),
      ).rejects.toMatchObject({ code: 'VISIT_NOT_DRAFT' } satisfies Partial<AppException>);
    });
  });

  describe('submit', () => {
    const submittable = {
      id: 'visit-1',
      ticketId: 'ticket-1',
      visitNumber: 1,
      status: 'DRAFT',
      workDone: 'Replaced the belt.',
      signatureKey: 'visits/visit-1/abc.png',
      signatureRefused: false,
      ticket: ticketOnSite,
      spares: [{ itemId: 'item-1', quantity: 2 }],
    };

    it('locks the visit, emits the event and notifies managers', async () => {
      const { prisma, notifier, events, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue(submittable);
      prisma.visit.update.mockResolvedValue({ ...submittable, status: 'SUBMITTED' });

      await service.submit(engineer, 'visit-1');

      expect(prisma.visit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'SUBMITTED' }) }),
      );
      expect(events.emitSubmitted).toHaveBeenCalledWith(
        expect.objectContaining({
          visitId: 'visit-1',
          ticketId: 'ticket-1',
          spareLines: [{ itemId: 'item-1', quantity: 2 }],
        }),
      );
      expect(notifier.visitSubmitted).toHaveBeenCalledWith(
        ticketOnSite,
        1,
        expect.objectContaining({ id: 'user-eng' }),
      );
    });

    it('returns 409 when submitted twice', async () => {
      const { prisma, events, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue({ ...submittable, status: 'SUBMITTED' });

      const err = await appError(service.submit(engineer, 'visit-1'));
      expect(err.code).toBe('VISIT_ALREADY_SUBMITTED');
      expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(events.emitSubmitted).not.toHaveBeenCalled();
    });

    it('requires work notes', async () => {
      const { prisma, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue({ ...submittable, workDone: '   ' });

      await expect(service.submit(engineer, 'visit-1')).rejects.toMatchObject({
        code: 'VISIT_NOTES_REQUIRED',
      } satisfies Partial<AppException>);
    });

    it('requires a signature or a recorded refusal', async () => {
      const { prisma, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue({
        ...submittable,
        signatureKey: null,
        signatureRefused: false,
      });

      await expect(service.submit(engineer, 'visit-1')).rejects.toMatchObject({
        code: 'VISIT_SIGNATURE_REQUIRED',
      } satisfies Partial<AppException>);
    });

    it('accepts a recorded refusal in place of a signature', async () => {
      const { prisma, events, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue({
        ...submittable,
        signatureKey: null,
        signatureRefused: true,
      });
      prisma.visit.update.mockResolvedValue({ ...submittable, status: 'SUBMITTED' });

      await expect(service.submit(engineer, 'visit-1')).resolves.toMatchObject({
        status: 'SUBMITTED',
      });
      expect(events.emitSubmitted).toHaveBeenCalled();
    });

    it('guards the status transition in the update where clause', async () => {
      const { prisma, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue(submittable);
      prisma.visit.update.mockResolvedValue({ ...submittable, status: 'SUBMITTED' });

      await service.submit(engineer, 'visit-1');

      expect(prisma.visit.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'visit-1', status: 'DRAFT' } }),
      );
    });

    it('SB-L6: a submit racing another submit fails cleanly, no duplicate side-effects', async () => {
      const { prisma, notifier, events, service } = mocks();
      // Both reads saw DRAFT; the guarded write finds no DRAFT row -> P2025.
      prisma.visit.findUnique.mockResolvedValue(submittable);
      const p2025 = Object.assign(new Error('Record not found'), { code: 'P2025' });
      prisma.visit.update.mockRejectedValue(p2025);

      const err = await appError(service.submit(engineer, 'visit-1'));
      expect(err.code).toBe('VISIT_ALREADY_SUBMITTED');
      expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(events.emitSubmitted).not.toHaveBeenCalled();
      expect(notifier.visitSubmitted).not.toHaveBeenCalled();
    });
  });

  describe('addSpare', () => {
    const draft = {
      id: 'visit-1',
      ticketId: 'ticket-1',
      visitNumber: 1,
      status: 'DRAFT',
      signatureKey: null,
      ticket: ticketOnSite,
    };

    it('rejects an unknown item', async () => {
      const { prisma, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue(draft);
      prisma.item.findFirst.mockResolvedValue(null);

      await expect(
        service.addSpare(engineer, 'visit-1', { itemId: 'nope', quantity: 1 }),
      ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' } satisfies Partial<AppException>);
    });

    it('warns but does not block when stock is short', async () => {
      const { prisma, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue(draft);
      prisma.item.findFirst.mockResolvedValue({ id: 'item-1', itemCode: 'BELT-9', name: 'Belt' });
      prisma.stockLevel.findMany.mockResolvedValue([{ actualQty: '1.0000' }]);
      prisma.visitSpare.create.mockResolvedValue({ id: 'spare-1', quantity: 2 });

      const spare = await service.addSpare(engineer, 'visit-1', { itemId: 'item-1', quantity: 2 });

      expect(spare.stockWarning).toBe(true);
      expect(prisma.visitSpare.create).toHaveBeenCalled();
    });

    it('stays quiet when stock covers the quantity', async () => {
      const { prisma, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue(draft);
      prisma.item.findFirst.mockResolvedValue({ id: 'item-1', itemCode: 'BELT-9', name: 'Belt' });
      prisma.stockLevel.findMany.mockResolvedValue([{ actualQty: '5.0000' }]);
      prisma.visitSpare.create.mockResolvedValue({ id: 'spare-1', quantity: 2 });

      const spare = await service.addSpare(engineer, 'visit-1', { itemId: 'item-1', quantity: 2 });

      expect(spare.stockWarning).toBe(false);
    });
  });

  describe('openSignature', () => {
    it('streams the stored signature file', async () => {
      const { prisma, storage, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue({
        ticketId: 'ticket-1',
        signatureKey: 'visits/visit-1/abc.png',
      });
      storage.read.mockReturnValue('fake-stream');

      const result = await service.openSignature(engineer, 'visit-1');

      expect(result.signatureKey).toBe('visits/visit-1/abc.png');
      expect(result.stream).toBe('fake-stream');
      expect(storage.read).toHaveBeenCalledWith('visits/visit-1/abc.png');
    });

    it('404s when the visit has no signature on file', async () => {
      const { prisma, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue({ ticketId: 'ticket-1', signatureKey: null });

      const err = await appError(service.openSignature(engineer, 'visit-1'));
      expect(err.code).toBe('FILE_NOT_FOUND');
      expect(err.getStatus()).toBe(HttpStatus.NOT_FOUND);
    });

    it('404s when the visit does not exist', async () => {
      const { prisma, service } = mocks();
      prisma.visit.findUnique.mockResolvedValue(null);

      const err = await appError(service.openSignature(engineer, 'nope'));
      expect(err.code).toBe('VISIT_NOT_FOUND');
      expect(err.getStatus()).toBe(HttpStatus.NOT_FOUND);
    });
  });
});
