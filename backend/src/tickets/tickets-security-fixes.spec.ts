import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../core/http/app.exception';
import type { PrismaService } from '../core/prisma/prisma.service';
import type { CreateTicketDto } from './dto';
import { TicketsService } from './tickets.service';

const verifier = {
  id: 'verifier-1',
  permissions: ['tickets.verify'],
  ticketScope: 'ALL',
  regionId: null,
} as unknown as AuthUser;

const desk = {
  id: 'desk-1',
  permissions: ['tickets.create'],
  ticketScope: 'ALL',
  regionId: null,
} as unknown as AuthUser;

const ownEngineer = {
  id: 'eng-1',
  permissions: ['tickets.create', 'tickets.work'],
  ticketScope: 'OWN',
  regionId: null,
} as unknown as AuthUser;

const baseTicket = {
  id: 't1',
  number: 'ET-26-000101',
  title: 'Press breakdown',
  version: 3,
  engineerId: 'eng-1',
  stageBeforeHold: null,
  closedAt: null,
  respondedAt: new Date('2026-09-01T10:00:00Z'),
  resolvedAt: null,
  verifiedAt: null,
  cancelledAt: null,
  responseDueAt: new Date('2026-09-02T10:00:00Z'),
  resolutionDueAt: new Date('2026-09-03T10:00:00Z'),
  responseMinutes: 240,
  resolutionMinutes: 2880,
  slaCalendarId: null,
  responseBreached: false,
  resolutionBreached: false,
  responseBreachedEver: false,
  resolutionBreachedEver: false,
};

const alwaysOpenClock = {
  clock: jest.fn().mockResolvedValue({
    rules: { alwaysOpen: true, holidays: [], hours: [] },
    timeZone: 'Asia/Kolkata',
  }),
};

function buildAct(ticket: Record<string, unknown>) {
  const tx = {
    ticket: {
      findFirst: jest.fn().mockResolvedValue(ticket),
      findUnique: jest
        .fn()
        .mockResolvedValue({ number: 'ET-26-000101', customer: { name: 'Acme', email: 'a@x.com' } }),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...ticket, ...data }),
        ),
    },
    ticketEvent: { create: jest.fn().mockResolvedValue({}) },
    quotation: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = {
    $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
    ticket: tx.ticket,
  };
  const settings = { quotations: jest.fn().mockResolvedValue({ requirePoBeforeWork: false }) };
  const csat = {
    tokenForTicket: jest
      .fn()
      .mockResolvedValue({ tokenId: 'tok1', url: 'https://app.example.com/feedback/abc' }),
    markEmailed: jest.fn().mockResolvedValue(undefined),
  };
  const email = { queueEmail: jest.fn().mockResolvedValue(true) };
  const service = new TicketsService(
    prisma as unknown as PrismaService,
    alwaysOpenClock as never,
    { forPincode: jest.fn().mockResolvedValue(null) } as never,
    settings as never,
    { sync: jest.fn() } as never,
    {} as never,
    { action: jest.fn(), created: jest.fn() } as never,
    { queue: jest.fn() } as never,
    { onTicketAction: jest.fn().mockResolvedValue(undefined) } as never,
    csat as never,
    email as never,
    { queueWhatsApp: jest.fn().mockResolvedValue(null) } as never,
    { sync: jest.fn() } as never,
  );
  jest.spyOn(service, 'detail').mockResolvedValue({ id: 't1' } as never);
  return { service, tx, csat, email };
}

async function catchError(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    return error as AppException;
  }
  throw new Error('Expected the promise to reject, but it resolved.');
}

describe('ticket security fixes (audit run-1)', () => {
  describe('SB-M6: optimistic locking at write time', () => {
    it('writes only when the version still matches; the loser gets VERSION_CONFLICT', async () => {
      const { service, tx } = buildAct({ ...baseTicket, stage: 'VERIFIED' });
      // Two closes fired on the same read version: the first commits, the
      // second hits the DB's no-row-matched error (P2025).
      (tx.ticket.update as jest.Mock)
        .mockResolvedValueOnce({ ...baseTicket, stage: 'CLOSED', version: 4 })
        .mockRejectedValueOnce({ code: 'P2025' });

      await service.act(verifier, 't1', { action: 'close', version: 3 });

      const error = await catchError(service.act(verifier, 't1', { action: 'close', version: 3 }));
      expect(error.code).toBe('VERSION_CONFLICT');
      expect(error.getStatus()).toBe(409);
    });

    it('includes the read version in the update where-clause', async () => {
      const { service, tx } = buildAct({ ...baseTicket, stage: 'VERIFIED' });
      await service.act(verifier, 't1', { action: 'close', version: 3 });
      expect(tx.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 't1', version: 3 } }),
      );
    });

    it('rethrows non-conflict write errors untouched', async () => {
      const { service, tx } = buildAct({ ...baseTicket, stage: 'VERIFIED' });
      (tx.ticket.update as jest.Mock).mockRejectedValueOnce(new Error('db down'));
      await expect(service.act(verifier, 't1', { action: 'close', version: 3 })).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('SB-M7: no raw survey link in the close response', () => {
    it('the close response carries email status but not feedbackUrl', async () => {
      const { service, csat, email } = buildAct({ ...baseTicket, stage: 'VERIFIED' });
      const result = await service.act(verifier, 't1', { action: 'close', version: 3 });

      expect(result).not.toHaveProperty('feedbackUrl');
      expect(result).toMatchObject({ feedbackEmailed: true });
      // The token is still minted (so the customer can be emailed the link).
      expect(csat.tokenForTicket).toHaveBeenCalledWith('t1', expect.anything());
      expect(csat.markEmailed).toHaveBeenCalledWith('tok1');
      expect(email.queueEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: expect.objectContaining({
            feedbackUrl: 'https://app.example.com/feedback/abc',
          }),
        }),
      );
    });

    it('non-close actions return the plain detail', async () => {
      const { service } = buildAct({ ...baseTicket, stage: 'RESOLVED' });
      const result = await service.act(verifier, 't1', { action: 'verify', version: 3 });
      expect(result).not.toHaveProperty('feedbackUrl');
      expect(result).not.toHaveProperty('feedbackEmailed');
    });
  });

  describe('SB-M8: breach history survives reopen', () => {
    it('reopen resets the live flag but never touches the sticky ever-breached flag', async () => {
      const { service, tx } = buildAct({
        ...baseTicket,
        stage: 'CLOSED',
        closedAt: new Date(),
        respondedAt: new Date('2026-09-01T10:00:00Z'),
        resolvedAt: new Date('2026-09-05T10:00:00Z'),
        resolutionBreached: true,
        resolutionBreachedEver: true,
      });

      await service.act(desk, 't1', { action: 'reopen', version: 3, note: 'Customer called back' });

      const data = (tx.ticket.update as jest.Mock).mock.calls[0][0].data;
      expect(data).toMatchObject({ resolutionBreached: false });
      // The sticky flag is never written here, so the DB keeps its true value.
      expect(data).not.toHaveProperty('resolutionBreachedEver');
    });

    it('a late accept sets both the live and the sticky response-breach flags', async () => {
      const { service, tx } = buildAct({
        ...baseTicket,
        stage: 'ASSIGNED',
        respondedAt: null,
        responseDueAt: new Date('2020-01-01T10:00:00Z'),
      });

      await service.act(ownEngineer, 't1', { action: 'accept', version: 3 });

      expect(tx.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            responseBreached: true,
            responseBreachedEver: true,
          }),
        }),
      );
    });

    it('a late resolve sets both the live and the sticky resolution-breach flags', async () => {
      const { service, tx } = buildAct({
        ...baseTicket,
        stage: 'IN_PROGRESS',
        resolutionDueAt: new Date('2020-01-01T10:00:00Z'),
      });

      await service.act(ownEngineer, 't1', { action: 'resolve', version: 3, note: 'Replaced the seal' });

      expect(tx.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resolutionBreached: true,
            resolutionBreachedEver: true,
          }),
        }),
      );
    });
  });

  describe('SB-L1: duplicate-suspect names only visible tickets', () => {
    const duplicateTx = (open: Array<{ number: string }>) => ({
      customer: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', sites: [] }) },
      equipment: { findUnique: jest.fn().mockResolvedValue({ id: 'e1', customerId: 'c1' }) },
      customerContact: { findUnique: jest.fn().mockResolvedValue(null) },
      serviceType: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'st1', active: true, defaultPriority: 'P3', requiresEquipment: false }),
      },
      ticket: {
        findMany: jest.fn().mockResolvedValue(open),
        create: jest.fn().mockResolvedValue({ id: 't2', number: 'ET-26-000201' }),
      },
      ticketCounter: { upsert: jest.fn().mockResolvedValue({ year: 2026, last: 201 }) },
    });

    const buildCreate = (open: Array<{ number: string }>) => {
      const tx = duplicateTx(open);
      const prisma = { $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) };
      const rules = {
        slaFor: jest.fn().mockResolvedValue({
          responseMinutes: 240,
          resolutionMinutes: 2880,
          slaCalendarId: null,
          responseDueAt: new Date('2026-10-02T10:00:00Z'),
          resolutionDueAt: new Date('2026-10-03T10:00:00Z'),
        }),
        ...alwaysOpenClock,
      };
      const settings = { company: jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' }) };
      const service = new TicketsService(
        prisma as unknown as PrismaService,
        rules as never,
        { forPincode: jest.fn().mockResolvedValue(null) } as never,
        settings as never,
        { sync: jest.fn() } as never,
        {} as never,
        { action: jest.fn(), created: jest.fn().mockResolvedValue(undefined) } as never,
        { queue: jest.fn().mockResolvedValue(undefined) } as never,
        {} as never,
        {} as never,
        {} as never,
        { queueWhatsApp: jest.fn().mockResolvedValue(null) } as never,
        { sync: jest.fn() } as never,
      );
      return { service, tx };
    };

    const dto = {
      customerId: 'c1',
      serviceTypeId: 'st1',
      equipmentId: 'e1',
      channel: 'PHONE',
      title: 'Pump is leaking badly',
    } as CreateTicketDto;

    it('409s without naming tickets outside the creator’s scope', async () => {
      const { service, tx } = buildCreate([{ number: 'ET-26-000101' }]);

      const error = await catchError(service.create(ownEngineer, dto));
      expect(error.code).toBe('DUPLICATE_SUSPECTED');

      // The scope filter is applied before any ticket number is embedded.
      expect(tx.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            equipmentId: 'e1',
            OR: [{ engineerId: 'eng-1' }, { createdById: 'eng-1' }],
          }),
        }),
      );
    });

    it('still lets the ticket through once duplicates are acknowledged', async () => {
      const { service } = buildCreate([{ number: 'ET-26-000101' }]);
      const result = await service.create(ownEngineer, { ...dto, acknowledgeDuplicates: true });
      expect(result).toMatchObject({ number: 'ET-26-000201' });
    });
  });
});
