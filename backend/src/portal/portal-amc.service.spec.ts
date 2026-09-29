import { PortalAmcService } from './portal-amc.service';
import type { CustomerIdentity } from './portal.guard';

const identity: CustomerIdentity = {
  contactId: 'c1',
  customerId: 'cust1',
  contactName: 'Asha Contact',
  email: 'asha@example.com',
};

const contractRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'amc1',
  number: 'AMC-26-0001',
  status: 'ACTIVE',
  startsOn: new Date('2026-04-01'),
  endsOn: new Date('2027-03-31'),
  equipment: [{ equipment: { id: 'eq1', itemName: 'Compressor X', serialNo: 'SN-1' } }],
  plannedVisits: [
    {
      id: 'pv1',
      plannedOn: new Date('2026-10-15'),
      status: 'PLANNED',
      equipment: { id: 'eq1', itemName: 'Compressor X', serialNo: 'SN-1' },
    },
  ],
  ...overrides,
});

const makeService = () => {
  const prisma = {
    amcContract: { findMany: jest.fn(), findFirst: jest.fn() },
  };
  const service = new PortalAmcService(prisma as never);
  return { service, prisma };
};

describe('PortalAmcService', () => {
  it('lists the customer\u2019s contracts without the contract value', async () => {
    const { service, prisma } = makeService();
    prisma.amcContract.findMany.mockResolvedValue([
      { id: 'amc1', number: 'AMC-26-0001', status: 'ACTIVE', startsOn: new Date(), endsOn: new Date(), _count: { equipment: 3 } },
    ]);
    const result = await service.list(identity);
    expect(result.items[0]).toEqual({
      id: 'amc1',
      number: 'AMC-26-0001',
      status: 'ACTIVE',
      startsOn: expect.any(Date),
      endsOn: expect.any(Date),
      equipmentCount: 3,
    });
    const select = prisma.amcContract.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('value');
    expect(prisma.amcContract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 'cust1' } }),
    );
  });

  it('404-masks another customer\u2019s contract', async () => {
    const { service, prisma } = makeService();
    prisma.amcContract.findFirst.mockResolvedValue(null);
    await expect(service.detail(identity, 'amc9')).rejects.toMatchObject({
      code: 'AMC_CONTRACT_NOT_FOUND',
      status: 404,
    });
  });

  it('returns equipment and planned visits, never the value', async () => {
    const { service, prisma } = makeService();
    prisma.amcContract.findFirst.mockResolvedValue(contractRow());
    const result = await service.detail(identity, 'amc1');
    expect(result).toEqual({
      id: 'amc1',
      number: 'AMC-26-0001',
      status: 'ACTIVE',
      startsOn: expect.any(Date),
      endsOn: expect.any(Date),
      equipment: [{ id: 'eq1', name: 'Compressor X' }],
      plannedVisits: [
        {
          id: 'pv1',
          plannedOn: expect.any(Date),
          status: 'PLANNED',
          equipment: { id: 'eq1', name: 'Compressor X' },
        },
      ],
    });
    const select = prisma.amcContract.findFirst.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('value');
  });
});
