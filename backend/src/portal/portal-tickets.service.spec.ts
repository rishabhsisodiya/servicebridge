import { PortalTicketsService } from './portal-tickets.service';
import type { CustomerIdentity } from './portal.guard';

const identity: CustomerIdentity = {
  contactId: 'c1',
  customerId: 'cust1',
  contactName: 'Asha Contact',
  email: 'asha@example.com',
};
const client = { ip: '10.0.0.1', userAgent: 'test', requestId: 'r1' } as never;

const makeService = (overrides: Record<string, unknown> = {}) => {
  const prisma = {
    equipment: { findFirst: jest.fn().mockResolvedValue({ id: 'eq1' }) },
    serviceType: { findFirst: jest.fn().mockResolvedValue({ id: 'st1' }) },
    ticket: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    ticketAttachment: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const tickets = { create: jest.fn().mockResolvedValue({ id: 't1', number: 'SB-26-0001' }) };
  const audit = { record: jest.fn() };
  const service = new PortalTicketsService(prisma as never, tickets as never, audit as never);
  return { service, prisma, tickets, audit };
};

describe('PortalTicketsService', () => {
  describe('create', () => {
    const dto = () => ({ title: 'Compressor not starting', description: 'Loud noise' });

    it('creates a PORTAL ticket through the synthetic-actor seam', async () => {
      const { service, tickets, audit } = makeService();
      await expect(service.create(identity, dto(), client)).resolves.toEqual({
        number: 'SB-26-0001',
      });
      const [actor, createDto, opts] = tickets.create.mock.calls[0];
      expect(actor.id).toBe('customer:c1');
      expect(createDto).toMatchObject({
        customerId: 'cust1',
        contactId: 'c1',
        channel: 'PORTAL',
        title: 'Compressor not starting',
      });
      // System-owned ticket: createdById null, exactly like the partner seam.
      expect(opts).toEqual({ createdById: null });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: null,
          action: 'portal.ticket_created',
          summary: expect.stringContaining('Asha Contact'),
        }),
      );
    });

    it('rejects equipment that is not the customer\u2019s', async () => {
      const { tickets } = makeService();
      const prisma = { equipment: { findFirst: jest.fn().mockResolvedValue(null) } };
      const scoped = new PortalTicketsService(
        { ...prisma, serviceType: { findFirst: jest.fn() } } as never,
        tickets as never,
        { record: jest.fn() } as never,
      );
      await expect(
        scoped.create(identity, { ...dto(), equipmentId: 'eq-other' }, client),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(tickets.create).not.toHaveBeenCalled();
    });

    it('falls back to the first active service type when none is given', async () => {
      const { service, tickets, prisma } = makeService();
      prisma.serviceType.findFirst.mockResolvedValue({ id: 'st9' });
      await service.create(identity, dto(), client);
      const createDto = tickets.create.mock.calls[0][1];
      expect(createDto.serviceTypeId).toBe('st9');
    });
  });

  describe('list', () => {
    it('pages the customer\u2019s tickets newest-first', async () => {
      const { service, prisma } = makeService();
      prisma.ticket.count.mockResolvedValue(2);
      prisma.ticket.findMany.mockResolvedValue([{ number: 'SB-26-0002' }, { number: 'SB-26-0001' }]);
      const result = await service.list(identity, 1, 20);
      expect(result).toMatchObject({ page: 1, pageSize: 20, total: 2 });
      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: 'cust1' },
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
    });
  });

  describe('detail', () => {
    const ticketRow = (overrides: Record<string, unknown> = {}) => ({
      id: 't1',
      number: 'SB-26-0001',
      title: 'Compressor not starting',
      description: 'Loud noise',
      stage: 'IN_PROGRESS',
      priority: 'HIGH',
      slaDueAt: null,
      createdAt: new Date('2026-09-20T10:00:00Z'),
      equipment: { id: 'eq1', itemName: 'Compressor X', serialNo: 'SN-1' },
      events: [
        { type: 'CREATED', toStage: null, createdAt: new Date(), data: null, actor: null },
        { type: 'NOTE', toStage: null, createdAt: new Date(), data: null, actor: null },
        {
          type: 'APPROVAL',
          toStage: null,
          createdAt: new Date(),
          data: { outcome: 'approved', contactName: 'Asha Contact' },
          actor: null,
        },
      ],
      csatTokens: [],
      ...overrides,
    });

    it('404-masks tickets that are not the customer\u2019s', async () => {
      const { service, prisma } = makeService();
      prisma.ticket.findFirst.mockResolvedValue(null);
      await expect(service.detail(identity, 'SB-26-9999')).rejects.toMatchObject({
        code: 'TICKET_NOT_FOUND',
        status: 404,
      });
      expect(prisma.ticket.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ customerId: 'cust1' }) }),
      );
    });

    it('shows the safe timeline subset only, with CSAT state', async () => {
      const { service, prisma } = makeService();
      // Simulate the database-level event-type filter: the mock applies the
      // select's where clause the way Prisma would.
      prisma.ticket.findFirst.mockImplementation(
        (args: { select?: { events?: { where?: { type?: { in?: string[] } } } } }) => {
          const row = ticketRow();
          const types = args.select?.events?.where?.type?.in ?? [];
          return Promise.resolve({
            ...row,
            events: row.events.filter((e) => types.includes(e.type)),
          });
        },
      );
      const result = await service.detail(identity, 'SB-26-0001');
      expect(result.number).toBe('SB-26-0001');
      expect(result.equipment).toEqual({ id: 'eq1', name: 'Compressor X' });
      // NOTE is filtered at the query level; only CREATED + APPROVAL remain.
      expect(result.timeline.map((t: { type: string }) => t.type)).toEqual([
        'CREATED',
        'APPROVAL',
      ]);
      expect(result.timeline[1].summary).toContain('Asha Contact');
      expect(result.csat).toEqual({ state: 'none' });
      expect(prisma.ticket.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            events: expect.objectContaining({
              where: { type: { in: expect.arrayContaining(['CREATED', 'APPROVAL']) } },
            }),
          }),
        }),
      );
    });

    it('reports answered CSAT state and customer-only attachments', async () => {
      const { service, prisma } = makeService();
      prisma.ticket.findFirst.mockResolvedValue(
        ticketRow({ csatTokens: [{ expiresAt: new Date(Date.now() + 1_000), response: { id: 'r1' } }] }),
      );
      prisma.ticketAttachment.findMany.mockResolvedValue([
        { id: 'a1', fileName: 'photo.jpg' },
      ]);
      const result = await service.detail(identity, 'SB-26-0001');
      expect(result.csat).toEqual({ state: 'answered' });
      expect(result.attachments).toEqual([{ id: 'a1', filename: 'photo.jpg' }]);
      expect(prisma.ticketAttachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ticketId: 't1', uploadedById: null } }),
      );
    });
  });
});
