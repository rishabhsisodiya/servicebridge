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
