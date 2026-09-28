import { PrismaService } from '../core/prisma/prisma.service';
import { QueueService } from '../core/queue/queue.service';
import { StorageService } from '../core/storage/storage.service';
import { AppSettingsService } from '../demo/app-settings.service';
import { EmailService } from '../notifications/email.service';
import { AuditService } from '../core/audit/audit.service';
import { KpiService } from './kpi.service';
import { RUN_REPORT_JOB, ReportsService, scheduleJobId } from './reports.service';

function mockPrisma(schedule: Record<string, unknown> | null = null) {
  const prisma = {
    reportSchedule: {
      findUnique: jest.fn().mockResolvedValue(schedule),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 's1', ...(data as object) }),
        ),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 's1', ...(data as object) }),
        ),
      delete: jest.fn().mockResolvedValue({}),
    },
    reportRun: {
      create: jest.fn().mockResolvedValue({ id: 'run1' }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn(),
  };
  // Transactions run against the same mock.
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

type MockPrisma = ReturnType<typeof mockPrisma>;

function service(prisma: MockPrisma) {
  const queue = {
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    removeJobScheduler: jest.fn().mockResolvedValue(undefined),
  };
  const queues = { queue: jest.fn().mockReturnValue(queue), register: jest.fn() };
  const svc = new ReportsService(
    prisma as unknown as PrismaService,
    queues as unknown as QueueService,
    {} as AppSettingsService,
    { queueEmail: jest.fn() } as unknown as EmailService,
    { save: jest.fn(), read: jest.fn() } as unknown as StorageService,
    { record: jest.fn() } as unknown as AuditService,
    {} as KpiService,
  );
  return { service: svc, queue };
}

const actor = { id: 'u1', name: 'Mira' } as never;
const client = { ip: null } as never;

const baseSchedule = {
  id: 's1',
  name: 'Weekly SLA',
  reportKey: 'sla-compliance',
  params: { from: '2026-09-01', to: '2026-09-28' },
  cron: '0 8 * * 1',
  timezone: 'Asia/Kolkata',
  recipients: ['u1'],
  active: false,
  version: 1,
  createdById: 'u1',
};

describe('ReportsService scheduler lifecycle', () => {
  it('activate registers a repeatable job with the fixed id', async () => {
    const prisma = mockPrisma({ ...baseSchedule, active: true });
    const { service: svc, queue } = service(prisma);
    await svc.activate('s1');
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      scheduleJobId('s1'),
      { pattern: '0 8 * * 1', tz: 'Asia/Kolkata' },
      { name: RUN_REPORT_JOB, data: { scheduleId: 's1' } },
    );
    expect(prisma.reportSchedule.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { active: true },
    });
  });

  it('deactivate removes the repeatable job', async () => {
    const prisma = mockPrisma({ ...baseSchedule, active: true });
    const { service: svc, queue } = service(prisma);
    await svc.deactivate('s1');
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(scheduleJobId('s1'));
  });

  it('delete removes the repeatable job too', async () => {
    const prisma = mockPrisma(baseSchedule);
    const { service: svc, queue } = service(prisma);
    await svc.deleteSchedule(actor, 's1', client);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(scheduleJobId('s1'));
  });

  it('reconcile re-registers every active schedule', async () => {
    const prisma = mockPrisma(null);
    (prisma.reportSchedule.findMany as jest.Mock).mockResolvedValue([
      { id: 's1', cron: '0 8 * * 1', timezone: 'Asia/Kolkata' },
      { id: 's2', cron: '0 9 * * *', timezone: 'Asia/Kolkata' },
    ]);
    const { service: svc, queue } = service(prisma);
    await svc.reconcile();
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      scheduleJobId('s2'),
      expect.anything(),
      expect.objectContaining({ data: { scheduleId: 's2' } }),
    );
  });

  it('executeScheduled skips deleted and inactive schedules without running', async () => {
    const prisma = mockPrisma(null);
    const { service: svc } = service(prisma);
    expect(await svc.executeScheduled({ data: { scheduleId: 'gone' } } as never)).toMatch(/deleted/);
    expect(prisma.reportRun.create).not.toHaveBeenCalled();

    const prisma2 = mockPrisma({ ...baseSchedule, active: false });
    const { service: svc2 } = service(prisma2);
    expect(await svc2.executeScheduled({ data: { scheduleId: 's1' } } as never)).toMatch(/switched off/);
    expect(prisma2.reportRun.create).not.toHaveBeenCalled();
  });
});

describe('ReportsService schedule validation', () => {
  it('rejects an unknown report key', async () => {
    const prisma = mockPrisma(null);
    const { service: svc } = service(prisma);
    await expect(
      svc.createSchedule(
        actor,
        { name: 'x', reportKey: 'nope', params: {}, cron: '0 8 * * 1', recipients: ['u1'] },
        client,
      ),
    ).rejects.toMatchObject({ code: 'REPORT_UNKNOWN' });
  });

  it('rejects a cron that runs too often', async () => {
    const prisma = mockPrisma(null);
    const { service: svc } = service(prisma);
    await expect(
      svc.createSchedule(
        actor,
        { name: 'x', reportKey: 'sla-compliance', params: {}, cron: '* * * * *', recipients: ['u1'] },
        client,
      ),
    ).rejects.toMatchObject({ code: 'SCHEDULE_BAD_CRON' });
  });

  it('rejects recipients that are not active users', async () => {
    const prisma = mockPrisma(null);
    const { service: svc } = service(prisma);
    await expect(
      svc.createSchedule(
        actor,
        { name: 'x', reportKey: 'sla-compliance', params: {}, cron: '0 8 * * 1', recipients: ['ghost'] },
        client,
      ),
    ).rejects.toMatchObject({ code: 'SCHEDULE_BAD_RECIPIENTS' });
  });

  it('update rejects a stale version', async () => {
    const prisma = mockPrisma({ ...baseSchedule, version: 2 });
    (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', email: 'a@b.c', name: 'Mira' }]);
    const { service: svc } = service(prisma);
    await expect(
      svc.updateSchedule(actor, 's1', { name: 'renamed', version: 1 }, client),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});
