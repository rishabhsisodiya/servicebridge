import { KpiService, KPI_META } from './kpi.service';

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    region: { findMany: jest.fn().mockResolvedValue([]) },
    ticket: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    csatResponse: { findMany: jest.fn().mockResolvedValue([]) },
    visit: { findMany: jest.fn().mockResolvedValue([]) },
    amcPlannedVisit: { findMany: jest.fn().mockResolvedValue([]) },
    appSetting: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(({ create }: { create: { value: unknown } }) => Promise.resolve(create)),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) =>
      fn({
        appSetting: {
          upsert: jest.fn().mockResolvedValue({}),
        },
      }),
    ),
    ...overrides,
  };
}

const manager = { id: 'u1', ticketScope: 'ALL' as const, regionId: null };
const areaManager = { id: 'u2', ticketScope: 'REGION' as const, regionId: 'r1' };

const REGIONS = [
  { id: 'r1', name: 'North' },
  { id: 'r2', name: 'South' },
];

const day = (n: number) => new Date(Date.UTC(2026, 8, n));

describe('KpiService.matrix', () => {
  it('computes the six KPIs per region from fixed fixtures', async () => {
    const prisma = mockPrisma({
      region: { findMany: jest.fn().mockResolvedValue(REGIONS) },
      ticket: {
        findMany: jest.fn().mockResolvedValue([
          // r1: 2 closed — one clean, one breached+reopened, resolved in 24h and 72h
          { regionId: 'r1', responseBreached: false, resolutionBreached: false, reopenCount: 0, createdAt: day(1), resolvedAt: day(2) },
          { regionId: 'r1', responseBreached: true, resolutionBreached: false, reopenCount: 1, createdAt: day(1), resolvedAt: day(4) },
          // r2: 1 closed, clean, resolved in 48h
          { regionId: 'r2', responseBreached: false, resolutionBreached: false, reopenCount: 0, createdAt: day(2), resolvedAt: day(4) },
        ]),
        groupBy: jest.fn().mockResolvedValue([
          { regionId: 'r1', _count: { _all: 3 } },
          { regionId: 'r2', _count: { _all: 1 } },
        ]),
      },
      csatResponse: {
        findMany: jest.fn().mockResolvedValue([
          { rating: 5, token: { ticket: { regionId: 'r1' } } },
          { rating: 4, token: { ticket: { regionId: 'r1' } } },
          { rating: 3, token: { ticket: { regionId: 'r2' } } },
        ]),
      },
      visit: {
        findMany: jest.fn().mockResolvedValue([
          { ticket: { regionId: 'r1' } },
          { ticket: { regionId: 'r1' } },
          { ticket: { regionId: 'r2' } },
        ]),
      },
      amcPlannedVisit: {
        findMany: jest.fn().mockResolvedValue([
          { ticket: { regionId: 'r1' } },
          { ticket: { regionId: 'r1' } },
          { ticket: { regionId: null } },
        ]),
      },
    });
    const service = new KpiService(prisma as never, { record: jest.fn() } as never);
    const { rows } = await service.matrix(manager, { from: '2026-09-01', to: '2026-09-28' });

    expect(rows.map((r) => r.regionName)).toEqual(['North', 'South', 'All regions']);
    const north = Object.fromEntries(rows[0].kpis.map((k) => [k.key, k]));
    expect(north['sla-compliance'].value).toBe(50);
    expect(north['sla-compliance'].met).toBe(false); // below the 95% target
    expect(north['avg-resolution-hours'].value).toBe(48); // (24+72)/2
    expect(north['avg-resolution-hours'].met).toBe(true); // <= 48
    expect(north['reopen-rate'].value).toBe(50);
    expect(north['csat-average'].value).toBe(4.5);
    expect(north['csat-average'].met).toBe(true);
    expect(north['backlog-change'].value).toBe(1); // 3 created - 2 closed
    expect(north['visit-completion'].value).toBe(100); // 2 submitted / 2 planned
  });

  it('shows null with met=null when there is no data', async () => {
    const prisma = mockPrisma({
      region: { findMany: jest.fn().mockResolvedValue(REGIONS) },
    });
    const service = new KpiService(prisma as never, { record: jest.fn() } as never);
    const { rows } = await service.matrix(manager, {});
    const north = rows[0].kpis;
    expect(north.find((k) => k.key === 'sla-compliance')).toMatchObject({ value: null, met: null });
    expect(north.find((k) => k.key === 'backlog-change')).toMatchObject({ value: 0, met: true });
  });

  it('restricts a REGION-scoped user to their own region row', async () => {
    const prisma = mockPrisma({
      region: { findMany: jest.fn().mockResolvedValue(REGIONS) },
    });
    const service = new KpiService(prisma as never, { record: jest.fn() } as never);
    const { rows } = await service.matrix(areaManager, {});
    expect(rows.map((r) => r.regionName)).toEqual(['North']);
    // The ticket queries are bounded by the user's scope (visibleTo).
    const closedWhere = (prisma.ticket.findMany as jest.Mock).mock.calls[0][0].where;
    expect(closedWhere.OR).toBeDefined();
  });

  it('merges regional target overrides over the global target', async () => {
    const prisma = mockPrisma({
      region: { findMany: jest.fn().mockResolvedValue(REGIONS) },
      appSetting: {
        findUnique: jest.fn().mockResolvedValue({
          value: { 'sla-compliance': { target: 95, regions: { r1: 90 } } },
        }),
      },
    });
    const service = new KpiService(prisma as never, { record: jest.fn() } as never);
    const { rows } = await service.matrix(manager, {});
    const north = rows[0].kpis.find((k) => k.key === 'sla-compliance')!;
    const south = rows[1].kpis.find((k) => k.key === 'sla-compliance')!;
    expect(north.target).toBe(90);
    expect(south.target).toBe(95);
  });
});

describe('KpiService.updateTargets', () => {
  const actor = { id: 'u1', name: 'Mira', ticketScope: 'ALL', regionId: null } as never;
  const client = { ip: null } as never;

  it('rejects non-numeric and negative targets', async () => {
    const service = new KpiService(mockPrisma() as never, { record: jest.fn() } as never);
    await expect(
      service.updateTargets(actor, { 'sla-compliance': { target: -1 } }, client),
    ).rejects.toThrow(/non-negative/);
    await expect(
      service.updateTargets(actor, { 'csat-average': { target: NaN } }, client),
    ).rejects.toThrow(/non-negative/);
  });

  it('ignores unknown KPI keys and persists the rest', async () => {
    const audit = { record: jest.fn() };
    const prisma = mockPrisma();
    const service = new KpiService(prisma as never, audit as never);
    const result = await service.updateTargets(
      actor,
      {
        'sla-compliance': { target: 98, regions: { r1: 97 } },
        bogus: { target: 1 },
      } as never,
      client,
    );
    expect(result).toEqual({ 'sla-compliance': { target: 98, regions: { r1: 97 } } });
    expect(audit.record).toHaveBeenCalled();
  });

  it('exposes the documented default targets', () => {
    expect(KPI_META['sla-compliance'].defaultTarget).toBe(95);
    expect(KPI_META['avg-resolution-hours'].defaultTarget).toBe(48);
    expect(KPI_META['reopen-rate'].defaultTarget).toBe(5);
    expect(KPI_META['csat-average'].defaultTarget).toBe(4.5);
    expect(KPI_META['backlog-change'].defaultTarget).toBe(0);
    expect(KPI_META['visit-completion'].defaultTarget).toBe(100);
  });
});
