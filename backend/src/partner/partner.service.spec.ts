import { PartnerService } from './partner.service';
import { PartnerCreateTicketDto } from './dto';

const partner = { keyId: 'k1', name: 'Acme', permissions: ['tickets.create', 'tickets.read'] };
const client = { ip: '127.0.0.1', requestId: 'r1' } as never;

const dto = (overrides: Partial<PartnerCreateTicketDto> = {}): PartnerCreateTicketDto =>
  ({
    customerErpName: 'Acme Industries',
    serviceTypeName: 'Breakdown',
    title: 'Compressor not starting',
    externalRef: 'ACME-1001',
    ...overrides,
  }) as PartnerCreateTicketDto;

const makeService = (overrides: Record<string, unknown> = {}) => {
  const ticketFindFirst = jest.fn().mockResolvedValue(null);
  const prisma = {
    ticket: {
      findFirst: ticketFindFirst,
      update: jest.fn().mockResolvedValue({}),
    },
    customer: {
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue({ id: 'cust1', name: 'Acme Industries', active: true }),
    },
    equipment: { findUnique: jest.fn(), findFirst: jest.fn() },
    serviceType: {
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue({ id: 'st1', name: 'Breakdown', active: true }),
    },
    ...overrides,
  };
  const tickets = {
    create: jest.fn().mockResolvedValue({ id: 't1', number: 'T-26-0001' }),
  };
  const audit = { record: jest.fn() };
  const service = new PartnerService(prisma as never, tickets as never, audit as never);
  return { service, prisma, tickets, audit, ticketFindFirst };
};

describe('PartnerService', () => {
  describe('createTicket', () => {
    it('resolves ERP names to ids and creates a PARTNER ticket', async () => {
      const { service, tickets, prisma, audit } = makeService();
      const result = await service.createTicket(partner, dto(), client);
      expect(result).toEqual({ id: 't1', number: 'T-26-0001', duplicate: false });
      const createDto = (tickets.create as jest.Mock).mock.calls[0][1];
      expect(createDto).toMatchObject({
        customerId: 'cust1',
        serviceTypeId: 'st1',
        channel: 'PARTNER',
        title: 'Compressor not starting',
      });
      // System-owned: createdById null.
      expect((tickets.create as jest.Mock).mock.calls[0][2]).toEqual({ createdById: null });
      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { partnerKeyId: 'k1', externalRef: 'ACME-1001' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'partner.ticket_created',
          actorId: null,
          partnerKeyId: 'k1',
        }),
      );
    });

    it('returns the existing ticket on a repeat POST (idempotent)', async () => {
      const { service, tickets, ticketFindFirst } = makeService();
      ticketFindFirst.mockResolvedValue({ id: 't1', number: 'T-26-0001' });
      const result = await service.createTicket(partner, dto(), client);
      expect(result).toEqual({ id: 't1', number: 'T-26-0001', duplicate: true });
      expect(tickets.create).not.toHaveBeenCalled();
    });

    it('recovers when a concurrent repeat hits the unique constraint', async () => {
      const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      const ticketFindFirst = jest
        .fn()
        .mockResolvedValueOnce(null) // pre-check misses
        .mockResolvedValueOnce({ id: 't1', number: 'T-26-0001' }); // refetch finds the winner
      const { tickets } = makeService();
      (tickets.create as jest.Mock).mockRejectedValue(p2002);
      const service = new PartnerService(
        {
          ticket: { findFirst: ticketFindFirst, update: jest.fn() },
          customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cust1', active: true }) },
          serviceType: { findFirst: jest.fn().mockResolvedValue({ id: 'st1', active: true }) },
        } as never,
        tickets as never,
        { record: jest.fn() } as never,
      );
      const result = await service.createTicket(partner, dto(), client);
      expect(result).toEqual({ id: 't1', number: 'T-26-0001', duplicate: true });
    });

    it('422s when the customer cannot be resolved', async () => {
      const { service, prisma } = makeService();
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.createTicket(partner, dto(), client)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });

    it('422s when neither customerId nor customerErpName is given', async () => {
      const { service } = makeService();
      const bad = dto();
      delete (bad as Partial<PartnerCreateTicketDto>).customerErpName;
      await expect(service.createTicket(partner, bad, client)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });

    it('resolves equipment by serial and folds contact info into the description', async () => {
      const { service, tickets, prisma } = makeService();
      (prisma.equipment.findFirst as jest.Mock).mockResolvedValue({
        id: 'eq1',
        customerId: 'cust1',
        active: true,
      });
      await service.createTicket(
        partner,
        dto({ equipmentSerial: 'SN-42', contactName: 'Ravi', contactMobile: '99999' }),
        client,
      );
      const createDto = (tickets.create as jest.Mock).mock.calls[0][1];
      expect(createDto.equipmentId).toBe('eq1');
      expect(createDto.description).toContain('Contact: Ravi 99999');
    });
  });

  describe('ticketStatus', () => {
    it('returns the status view for the key’s own ticket', async () => {
      const { service, prisma } = makeService();
      (prisma.ticket.findFirst as jest.Mock).mockResolvedValue({
        number: 'T-26-0001',
        title: 'Compressor not starting',
        stage: 'IN_PROGRESS',
        priority: 'HIGH',
        engineer: { name: 'Mira' },
        createdAt: new Date(),
        respondedAt: new Date(),
        resolvedAt: null,
        closedAt: null,
        slaDueAt: new Date(),
        externalRef: 'ACME-1001',
      });
      const view = await service.ticketStatus(partner, 'T-26-0001');
      expect(view.number).toBe('T-26-0001');
      expect(view.engineer).toBe('Mira');
      expect(view).not.toHaveProperty('description');
      expect(view).not.toHaveProperty('quotations');
    });

    it('404s for another key’s ticket (no enumeration detail)', async () => {
      const { service, prisma } = makeService();
      (prisma.ticket.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.ticketStatus(partner, 'T-26-0002')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(prisma.ticket.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { number: 'T-26-0002', partnerKeyId: 'k1' } }),
      );
    });
  });
});
