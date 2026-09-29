import type { AuthUser } from '../auth/auth.types';
import type { PrismaService } from '../core/prisma/prisma.service';
import { AppException } from '../core/http/app.exception';
import { TicketsService } from './tickets.service';

const verifier = {
  id: 'verifier-1',
  permissions: ['tickets.verify'],
  ticketScope: 'ALL',
  regionId: null,
} as unknown as AuthUser;

const engineer = {
  id: 'engineer-1',
  permissions: ['tickets.work'],
  ticketScope: 'OWN',
  regionId: null,
} as unknown as AuthUser;

const baseTicket = {
  id: 't1',
  number: 'SB-26-000101',
  title: 'Press breakdown',
  version: 3,
  engineerId: 'engineer-1',
  stageBeforeHold: null,
  closedAt: null,
  respondedAt: new Date('2026-09-01T10:00:00Z'),
  resolvedAt: null,
  verifiedAt: null,
  responseDueAt: new Date('2026-09-02T10:00:00Z'),
  resolutionDueAt: new Date('2026-09-03T10:00:00Z'),
  responseMinutes: 240,
  resolutionMinutes: 2880,
};

const blockingQuotation = {
  id: 'q1',
  number: 'QT-26-000007',
  status: 'SENT',
  sentAt: new Date('2026-09-01T10:00:00Z'),
  poNumber: null,
  revisesId: null,
  createdAt: new Date('2026-09-01T09:00:00Z'),
};

function build({ gateOn, blocking }: { gateOn: boolean; blocking: boolean }) {
  const tx = {
    ticket: {
      findFirst: jest.fn().mockResolvedValue({ ...baseTicket, stage: 'RESOLVED' }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...baseTicket, stage: 'RESOLVED', ...data }),
      ),
    },
    ticketEvent: { create: jest.fn().mockResolvedValue({}) },
    quotation: { findMany: jest.fn().mockResolvedValue(blocking ? [blockingQuotation] : []) },
  };
  const prisma = { $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) };
  const settings = {
    quotations: jest.fn().mockResolvedValue({ requirePoBeforeWork: gateOn }),
  };
  const service = new TicketsService(
    prisma as unknown as PrismaService,
    {} as never,
    {} as never,
    settings as never,
    { sync: jest.fn() } as never,
    {} as never,
    { action: jest.fn() } as never,
    {} as never,
    { onTicketAction: jest.fn().mockResolvedValue(undefined) } as never,
    { tokenForTicket: jest.fn().mockResolvedValue(null) } as never,
    {} as never,
    { queueWhatsApp: jest.fn().mockResolvedValue(null) } as never,
    { sync: jest.fn() } as never,
  );
  jest.spyOn(service, 'detail').mockResolvedValue({ id: 't1' } as never);
  return { service, tx, settings };
}

async function poError(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    return error as AppException;
  }
  throw new Error('Expected the promise to reject, but it resolved.');
}

describe('PO gate on ticket actions (SB-H1/SB-H2)', () => {
  it('SB-H2: reject (RESOLVED → IN_PROGRESS) is blocked while a quotation waits for a PO', async () => {
    const { service, tx } = build({ gateOn: true, blocking: true });

    const error = await poError(
      service.act(verifier, 't1', { action: 'reject', version: 3, note: 'rework needed' }),
    );

    expect(error.code).toBe('PO_REQUIRED');
    expect(tx.ticket.update).not.toHaveBeenCalled();
  });

  it('reject proceeds to IN_PROGRESS once the PO is recorded', async () => {
    const { service, tx } = build({ gateOn: true, blocking: false });

    await service.act(verifier, 't1', { action: 'reject', version: 3, note: 'rework needed' });

    expect(tx.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stage: 'IN_PROGRESS' }) }),
    );
  });

  it('start is still gated (no regression)', async () => {
    const { service, tx } = build({ gateOn: true, blocking: true });
    tx.ticket.findFirst.mockResolvedValue({ ...baseTicket, stage: 'ON_SITE' });

    const error = await poError(service.act(engineer, 't1', { action: 'start', version: 3 }));

    expect(error.code).toBe('PO_REQUIRED');
    expect(tx.ticket.update).not.toHaveBeenCalled();
  });

  it('start proceeds when the gate is switched off', async () => {
    const { service, tx, settings } = build({ gateOn: false, blocking: true });
    tx.ticket.findFirst.mockResolvedValue({ ...baseTicket, stage: 'ON_SITE' });

    await service.act(engineer, 't1', { action: 'start', version: 3 });

    expect(settings.quotations).toHaveBeenCalled();
    expect(tx.quotation.findMany).not.toHaveBeenCalled();
    expect(tx.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stage: 'IN_PROGRESS' }) }),
    );
  });

  it('actions not landing in IN_PROGRESS skip the gate', async () => {
    const { service, tx } = build({ gateOn: true, blocking: true });
    tx.ticket.findFirst.mockResolvedValue({ ...baseTicket, stage: 'VERIFIED' });

    await service.act(verifier, 't1', { action: 'close', version: 3 });

    expect(tx.quotation.findMany).not.toHaveBeenCalled();
    expect(tx.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stage: 'CLOSED' }) }),
    );
  });
});
