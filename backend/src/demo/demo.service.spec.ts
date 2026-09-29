import type { AuditService } from '../core/audit/audit.service';
import type { PrismaService } from '../core/prisma/prisma.service';
import { passwordProblems } from '../core/security/password';
import type { AppSettingsService } from './app-settings.service';
import { CLEAR_CONFIRMATION, DemoService, demoPassword } from './demo.service';

function build(actorIsDemo: boolean) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ isDemo: actorIsDemo }) },
    $transaction: jest.fn(),
  };
  return {
    service: new DemoService(
      prisma as unknown as PrismaService,
      {} as AppSettingsService,
      {} as AuditService,
    ),
    prisma,
  };
}

describe('DemoService', () => {
  it('needs the exact confirmation phrase to clear', async () => {
    const { service, prisma } = build(false);
    await expect(
      service.clear({ id: 'a1', name: 'Admin' }, 'delete demo data'),
    ).rejects.toMatchObject({
      code: 'CONFIRMATION_MISMATCH',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses when the person doing it is a demo user (they would delete themselves)', async () => {
    const { service } = build(true);
    await expect(
      service.clear({ id: 'd1', name: 'Demo' }, CLEAR_CONFIRMATION),
    ).rejects.toMatchObject({
      code: 'DEMO_ACTOR',
    });
    await expect(service.load({ id: 'd1', name: 'Demo' })).rejects.toMatchObject({
      code: 'DEMO_ACTOR',
    });
  });

  it('generates demo passwords that pass the password policy', () => {
    for (let i = 0; i < 50; i += 1) expect(passwordProblems(demoPassword())).toEqual([]);
  });
});

/** Full-transaction mock for load(): every delegate the seed touches. */
function buildLoad(real: { regions: number; customers: number; tickets: number }) {
  const createdRegionIds: string[] = [];
  const tx: Record<string, Record<string, jest.Mock>> = {};
  for (const name of [
    'stockLevel',
    'itemPrice',
    'item',
    'warehouse',
    'equipment',
    'site',
    'customerContact',
    'customer',
    'skillTag',
    'regionRule',
    'user',
    'region',
    'appSetting',
  ]) {
    tx[name] = {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockImplementation((args?: { where?: { email?: { in: string[] }; isDemo?: boolean } }) => {
        if (name === 'user' && args?.where?.isDemo) {
          // seedServiceRules lookup: the demo users the seed just created.
          return Promise.resolve(
            (args.where.email?.in ?? []).map((email: string) => ({ id: `uid-${email}`, email })),
          );
        }
        return Promise.resolve([]);
      }),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `id-${String(data.name ?? 'row')}`, ...data };
        if (name === 'region') createdRegionIds.push(row.id);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    };
  }
  const prisma: Record<string, Record<string, jest.Mock>> = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ isDemo: false }),
      count: jest.fn().mockResolvedValue(0),
    },
    role: { findMany: jest.fn().mockResolvedValue([]) },
    region: { count: jest.fn().mockResolvedValue(real.regions) },
    customer: { count: jest.fn().mockResolvedValue(real.customers) },
    ticket: { count: jest.fn().mockResolvedValue(real.tickets) },
    site: { count: jest.fn().mockResolvedValue(0) },
    customerContact: { count: jest.fn().mockResolvedValue(0) },
    equipment: { count: jest.fn().mockResolvedValue(0) },
    item: { count: jest.fn().mockResolvedValue(0) },
    itemPrice: { count: jest.fn().mockResolvedValue(0) },
    warehouse: { count: jest.fn().mockResolvedValue(0) },
    stockLevel: { count: jest.fn().mockResolvedValue(0) },
  };
  const prismaWithTx = {
    ...prisma,
    $transaction: jest.fn().mockImplementation((arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
      return (arg as (t: unknown) => unknown)(tx);
    }),
  };
  const settings = { setCompany: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new DemoService(
    prismaWithTx as unknown as PrismaService,
    settings as unknown as AppSettingsService,
    audit as unknown as AuditService,
  );
  return { service, tx, createdRegionIds };
}

describe('DemoService.load guards', () => {
  it('refuses to seed a non-empty install without confirmation', async () => {
    const { service, tx } = buildLoad({ regions: 2, customers: 0, tickets: 0 });
    await expect(service.load({ id: 'a1', name: 'Admin' })).rejects.toMatchObject({
      code: 'DEMO_CONFIRMATION_REQUIRED',
    });
    // Nothing was seeded.
    expect(tx.region.create).not.toHaveBeenCalled();
    expect(tx.user.createMany).not.toHaveBeenCalled();
  });

  it('refuses when the non-empty signal comes from customers or tickets alone', async () => {
    const { service } = buildLoad({ regions: 0, customers: 4, tickets: 0 });
    await expect(service.load({ id: 'a1', name: 'Admin' })).rejects.toMatchObject({
      code: 'DEMO_CONFIRMATION_REQUIRED',
    });
    const { service: service2 } = buildLoad({ regions: 0, customers: 0, tickets: 9 });
    await expect(service2.load({ id: 'a1', name: 'Admin' })).rejects.toMatchObject({
      code: 'DEMO_CONFIRMATION_REQUIRED',
    });
  });

  it('seeds an empty install without confirmation', async () => {
    const { service, tx } = buildLoad({ regions: 0, customers: 0, tickets: 0 });
    await service.load({ id: 'a1', name: 'Admin' });
    expect(tx.region.create).toHaveBeenCalled();
  });

  it('never reuses real region rows, even with confirmation', async () => {
    const { service, tx, createdRegionIds } = buildLoad({ regions: 3, customers: 5, tickets: 12 });
    await service.load({ id: 'a1', name: 'Admin' }, null, { confirmed: true });

    // Demo regions are created fresh with clearly demo-marked names.
    const createdNames = tx.region.create.mock.calls.map(
      (call) => (call[0].data as { name: string }).name,
    );
    expect(createdNames.length).toBeGreaterThan(0);
    for (const name of createdNames) expect(name).toMatch(/\(Demo\)$/);
    // The seed never looks a region up by its plain (real) name, and every
    // lookup is restricted to demo-owned rows.
    expect(tx.region.findUnique).not.toHaveBeenCalled();
    for (const call of tx.region.findFirst.mock.calls) {
      expect((call[0].where as { isDemo: boolean }).isDemo).toBe(true);
    }
    // Demo users are attached only to demo-created regions…
    const userRows = tx.user.createMany.mock.calls[0][0].data as {
      regionId: string | null;
    }[];
    expect(userRows.length).toBeGreaterThan(0);
    for (const row of userRows) {
      if (row.regionId) expect(createdRegionIds).toContain(row.regionId);
    }
    // …and area-manager assignment only touches demo-created regions.
    expect(tx.region.updateMany).toHaveBeenCalled();
    for (const call of tx.region.updateMany.mock.calls) {
      expect(createdRegionIds).toContain((call[0].where as { id: string }).id);
    }
  });
});
