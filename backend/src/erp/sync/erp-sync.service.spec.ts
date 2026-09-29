import { ErpSyncService } from './erp-sync.service';

const equipmentSpec = {
  doctype: 'Serial No',
  table: 'equipment',
  label: 'machines',
  map: () => ({ serialNo: 'SN-1', amcExpiresOn: new Date('2027-01-01') }),
};

const makeService = (prisma: Record<string, unknown>) =>
  new ErpSyncService(prisma as never, {} as never, {} as never, {} as never);

describe('ErpSyncService equipment upsert', () => {
  const doc = { name: 'SN-001', modified: '2026-09-28 10:00:00' };

  const runUpsert = async (coveredErpNames: (string | null)[]) => {
    const upsert = jest.fn();
    const prisma = {
      equipment: {
        findMany: jest.fn().mockResolvedValue(coveredErpNames.map((erpName) => ({ erpName }))),
        upsert,
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    const service = makeService(prisma);
    await (service as unknown as { upsert: (...a: unknown[]) => Promise<void> }).upsert(
      'conn1',
      equipmentSpec,
      [doc],
      new Map(),
    );
    return upsert.mock.calls[0]?.[0] as { create: Record<string, unknown>; update: Record<string, unknown> };
  };

  it('keeps the local AMC date when an active local contract covers the machine', async () => {
    const args = await runUpsert(['SN-001']);
    expect(args.update).not.toHaveProperty('amcExpiresOn');
    // …but a brand-new machine still gets the ERP date on create.
    expect(args.create).toHaveProperty('amcExpiresOn');
  });

  it('takes the ERP AMC date when no active local contract covers the machine', async () => {
    const args = await runUpsert([]);
    expect(args.update).toHaveProperty('amcExpiresOn');
  });
});

describe('ErpSyncService.syncOne on_trash (SB-H5)', () => {
  const doc = { name: 'CUST-0001', customer_name: 'Acme', modified: '2026-09-29 01:00:00' };

  function build(getDocResult: unknown) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      erpPurposeBinding: {
        findUnique: jest.fn().mockResolvedValue({
          connection: { id: 'conn1', status: 'ACTIVE' },
        }),
      },
      customer: { updateMany, upsert, findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    };
    const service = new ErpSyncService(prisma as never, {} as never, {} as never, {} as never);
    const client = { getDoc: jest.fn().mockResolvedValue(getDocResult), close: jest.fn() };
    (service as unknown as { client: jest.Mock }).client = jest.fn().mockResolvedValue(client);
    return { service, updateMany, upsert };
  }

  it('ignores a forged on_trash when the record still exists in the ERP', async () => {
    const { service, updateMany } = build(doc);

    const summary = await service.syncOne('conn1', 'Customer', 'CUST-0001', 'on_trash');

    expect(summary).toMatch(/still exists in ERPNext/);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('deactivates on a genuine on_trash (record really gone)', async () => {
    const { service, updateMany } = build(undefined);

    const summary = await service.syncOne('conn1', 'Customer', 'CUST-0001', 'on_trash');

    expect(summary).toMatch(/marked inactive/);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ active: false }) }),
    );
  });

  it('still upserts on on_update when the record exists (legitimate flow)', async () => {
    const { service, upsert } = build(doc);

    const summary = await service.syncOne('conn1', 'Customer', 'CUST-0001', 'on_update');

    expect(summary).toBe('Updated Customer CUST-0001.');
    expect(upsert).toHaveBeenCalled();
  });
});
