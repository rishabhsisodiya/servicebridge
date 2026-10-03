import { PortalQuotationsService } from './portal-quotations.service';
import type { CustomerIdentity } from './portal.guard';

const identity: CustomerIdentity = {
  contactId: 'c1',
  customerId: 'cust1',
  contactName: 'Asha Contact',
  email: 'asha@example.com',
};
const client = { ip: '10.0.0.1', userAgent: 'test', requestId: 'r1' } as never;

const quotationRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'q1',
  number: 'QT-26-0001',
  status: 'SENT',
  ticket: { id: 't1', number: 'ET-26-0001', engineerId: 'eng1', areaManagerId: 'am1' },
  ...overrides,
});

const makeService = (overrides: Record<string, unknown> = {}) => {
  const quotation = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(quotationRow()),
    update: jest.fn().mockResolvedValue({}),
  };
  const ticketEvent = { create: jest.fn() };
  const tx = { quotation, ticketEvent };
  const prisma = {
    quotation,
    ticketEvent,
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    ...overrides,
  };
  const audit = { record: jest.fn() };
  const notifications = { notify: jest.fn() };
  const service = new PortalQuotationsService(
    prisma as never,
    audit as never,
    notifications as never,
  );
  return { service, prisma, audit, notifications };
};

describe('PortalQuotationsService', () => {
  describe('list', () => {
    it('shows only SENT and PO_RECEIVED quotations on the customer\u2019s tickets', async () => {
      const { service, prisma } = makeService();
      prisma.quotation.findMany.mockResolvedValue([{ id: 'q1' }]);
      await expect(service.list(identity, 'ET-26-0001')).resolves.toEqual({
        items: [{ id: 'q1' }],
      });
      expect(prisma.quotation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: { in: ['SENT', 'PO_RECEIVED'] },
            ticket: { customerId: 'cust1', number: 'ET-26-0001' },
          },
        }),
      );
      // Lines show quantity + rate only — no cost columns may leak.
      const select = prisma.quotation.findMany.mock.calls[0][0].select;
      expect(select.lines.select).toEqual({ quantity: true, rate: true });
    });
  });

  describe('approve', () => {
    it('404-masks another customer\u2019s quotation', async () => {
      const { service, prisma } = makeService();
      prisma.quotation.findFirst.mockResolvedValue(null);
      await expect(service.approve(identity, 'q9', {}, client)).rejects.toMatchObject({
        code: 'QUOTATION_NOT_FOUND',
        status: 404,
      });
    });

    it('rejects approve on a non-SENT quotation', async () => {
      const { service, prisma } = makeService();
      prisma.quotation.findFirst.mockResolvedValue(quotationRow({ status: 'PO_RECEIVED' }));
      await expect(service.approve(identity, 'q1', {}, client)).rejects.toMatchObject({
        code: 'QUOTATION_NOT_APPROVABLE',
        status: 409,
      });
    });

    it('stamps approval, writes an APPROVAL event and notifies staff', async () => {
      const { service, prisma, audit, notifications } = makeService();
      await expect(service.approve(identity, 'q1', {}, client)).resolves.toEqual({
        ok: true,
        status: 'SENT',
      });
      expect(prisma.quotation.update).toHaveBeenCalledWith({
        where: { id: 'q1', status: 'SENT' },
        data: { approvedByCustomerAt: expect.any(Date) },
      });
      expect(prisma.ticketEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ticketId: 't1',
          type: 'APPROVAL',
          actorId: null,
          data: expect.objectContaining({ outcome: 'approved', contactName: 'Asha Contact' }),
        }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: null, action: 'portal.quotation_approved' }),
        expect.anything(),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userIds: ['eng1', 'am1'],
          ticketId: 't1',
          title: expect.stringContaining('QT-26-0001'),
        }),
      );
    });

    it('moves SENT to PO_RECEIVED when a PO number is supplied', async () => {
      const { service, prisma } = makeService();
      await expect(
        service.approve(identity, 'q1', { poNumber: 'PO-42', poDate: '2026-09-29' }, client),
      ).resolves.toEqual({ ok: true, status: 'PO_RECEIVED' });
      expect(prisma.quotation.update).toHaveBeenCalledWith({
        where: { id: 'q1', status: 'SENT' },
        data: expect.objectContaining({
          status: 'PO_RECEIVED',
          poNumber: 'PO-42',
          poDate: new Date('2026-09-29T00:00:00Z'),
          poReceivedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      });
    });

    it('409s when the quotation changes between read and approve stamp', async () => {
      const { service, prisma } = makeService();
      const p2025 = Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
      prisma.quotation.update.mockRejectedValue(p2025);
      await expect(service.approve(identity, 'q1', {}, client)).rejects.toMatchObject({
        code: 'QUOTATION_NOT_APPROVABLE',
        status: 409,
      });
      // The stamp was attempted with the SENT guard; nothing else ran.
      expect(prisma.quotation.update).toHaveBeenCalledWith({
        where: { id: 'q1', status: 'SENT' },
        data: { approvedByCustomerAt: expect.any(Date) },
      });
      expect(prisma.ticketEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('writes an APPROVAL event with the rejection and leaves status alone', async () => {
      const { service, prisma, audit, notifications } = makeService();
      await expect(
        service.reject(identity, 'q1', { reason: 'Too expensive' }, client),
      ).resolves.toEqual({ ok: true });
      expect(prisma.quotation.update).not.toHaveBeenCalled();
      expect(prisma.ticketEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'APPROVAL',
          data: expect.objectContaining({
            outcome: 'rejected',
            contactName: 'Asha Contact',
            reason: 'Too expensive',
          }),
        }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'portal.quotation_rejected' }),
        expect.anything(),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userIds: ['eng1', 'am1'] }),
      );
    });
  });
});
