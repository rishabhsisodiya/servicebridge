import { AmcService } from './amc.service';

const txOf = (overrides: Record<string, unknown> = {}) => ({
  amcContract: {
    create: jest.fn().mockResolvedValue({ id: 'c1' }),
    update: jest.fn(),
    findUnique: jest.fn(),
    ...((overrides.amcContract as Record<string, unknown>) ?? {}),
  },
  amcContractEquipment: {
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
  amcPlannedVisit: {
    create: jest.fn(),
    deleteMany: jest.fn(),
    delete: jest.fn(),
  },
  ...overrides,
});

const makeService = (prisma: Record<string, unknown>) => {
  const audit = { record: jest.fn() };
  const scheduler = { sync: jest.fn(), cancel: jest.fn() };
  const service = new AmcService(prisma as never, audit as never, scheduler as never);
  return { service, audit, scheduler };
};

const actor = { id: 'u1', name: 'Mira' } as never;
const client = { ip: '127.0.0.1', requestId: 'r1' } as never;

describe('AmcService', () => {
  describe('create', () => {
    it('numbers contracts AMC-YY-000NNN from the yearly counter', async () => {
      const tx = txOf();
      const prisma = {
        customer: { findUnique: jest.fn().mockResolvedValue({ id: 'cust1', name: 'Acme' }) },
        equipment: { findMany: jest.fn().mockResolvedValue([]) },
        amcContractCounter: {
          upsert: jest.fn().mockResolvedValue({ year: 2026, lastNumber: 123 }),
        },
        amcContract: { findUnique: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      };
      const { service } = makeService(prisma);
      // get() after create
      (prisma.amcContract.findUnique).mockResolvedValue({ id: 'c1', number: 'AMC-26-000123' });
      const result = await service.create(
        actor,
        { customerId: 'cust1', startsOn: '2026-04-01', endsOn: '2027-03-31' },
        client,
      );
      expect(tx.amcContract.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ number: 'AMC-26-000123' }) }),
      );
      expect(result).toMatchObject({ number: 'AMC-26-000123' });
    });

    it('rejects an end date before the start date', async () => {
      const prisma = {
        customer: { findUnique: jest.fn().mockResolvedValue({ id: 'cust1', name: 'Acme' }) },
      };
      const { service } = makeService(prisma);
      await expect(
        service.create(actor, { customerId: 'cust1', startsOn: '2027-03-31', endsOn: '2026-04-01' }, client),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('recomputeEquipmentDates', () => {
    it('takes the latest endsOn across ACTIVE contracts only', async () => {
      const update = jest.fn();
      const prisma = {
        amcContract: {
          findFirst: jest.fn().mockResolvedValue({ endsOn: new Date('2027-06-30') }),
        },
        equipment: { update },
      };
      const { service } = makeService(prisma);
      await service.recomputeEquipmentDates(['eq1']);
      expect(prisma.amcContract.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ACTIVE', equipment: { some: { equipmentId: 'eq1' } } },
          orderBy: { endsOn: 'desc' },
        }),
      );
      expect(update).toHaveBeenCalledWith({
        where: { id: 'eq1' },
        data: { amcExpiresOn: new Date('2027-06-30') },
      });
    });

    it('leaves the machine alone when no active contract covers it', async () => {
      const update = jest.fn();
      const prisma = {
        amcContract: { findFirst: jest.fn().mockResolvedValue(null) },
        equipment: { update },
      };
      const { service } = makeService(prisma);
      await service.recomputeEquipmentDates(['eq1']);
      expect(update).not.toHaveBeenCalled();
    });
  });
});
