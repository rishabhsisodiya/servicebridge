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
      findUnique: jest.fn().mockResolvedValue(null),
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
    getJobSchedulers: jest.fn().mockResolvedValue([]),
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

const actor = { id: 'u1', name: 'Mira', isAdmin: false } as never;
const other = { id: 'u2', name: 'Theo', isAdmin: false } as never;
const admin = { id: 'admin-1', name: 'Admin', isAdmin: true } as never;
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
    await svc.activate(actor, 's1');
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
    await svc.deactivate(actor, 's1');
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

describe('ReportsService schedule ownership', () => {
  it('rejects a non-owner update with 403', async () => {
    const prisma = mockPrisma(baseSchedule);
    const { service: svc } = service(prisma);
    await expect(
      svc.updateSchedule(other, 's1', { name: 'hijacked', version: 1 }, client),
    ).rejects.toMatchObject({ code: 'SCHEDULE_FORBIDDEN', status: 403 });
    expect(prisma.reportSchedule.update).not.toHaveBeenCalled();
  });

  it('lets the owner update, and lets an administrator update anyone’s schedule', async () => {
    for (const who of [actor, admin]) {
      const prisma = mockPrisma(baseSchedule);
      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        { id: 'u1', email: 'a@b.c', name: 'Mira' },
      ]);
      const { service: svc } = service(prisma);
      const row = await svc.updateSchedule(who, 's1', { name: 'Renamed', version: 1 }, client);
      expect(row.name).toBe('Renamed');
    }
  });

  it('rejects a non-owner delete/activate/deactivate with 403', async () => {
    const prisma = mockPrisma(baseSchedule);
    const { service: svc } = service(prisma);
    await expect(svc.deleteSchedule(other, 's1', client)).rejects.toMatchObject({
      code: 'SCHEDULE_FORBIDDEN',
    });
    await expect(svc.activate(other, 's1')).rejects.toMatchObject({
      code: 'SCHEDULE_FORBIDDEN',
    });
    await expect(svc.deactivate(other, 's1')).rejects.toMatchObject({
      code: 'SCHEDULE_FORBIDDEN',
    });
  });

  it('lists only the caller’s schedules for non-admins, everything for admins', async () => {
    const prisma = mockPrisma(null);
    const { service: svc } = service(prisma);
    await svc.listSchedules(other);
    expect(prisma.reportSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdById: 'u2' } }),
    );
    await svc.listSchedules(admin);
    expect(prisma.reportSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });

  it('hides another owner’s schedule behind a 404', async () => {
    const prisma = mockPrisma(baseSchedule);
    const { service: svc } = service(prisma);
    await expect(svc.getSchedule(other, 's1')).rejects.toMatchObject({
      code: 'SCHEDULE_NOT_FOUND',
    });
    await expect(svc.getSchedule(admin, 's1')).resolves.toMatchObject({ id: 's1' });
  });

  it('restricts run history to the owner, recipients and admins', async () => {
    const prisma = mockPrisma({ ...baseSchedule, recipients: ['u2'] });
    (prisma.reportRun.findMany as jest.Mock).mockResolvedValue([
      { id: 'r1', csvKey: 'reports/r1.csv', status: 'SUCCESS' },
    ]);
    const { service: svc } = service(prisma);

    // A stranger with the permission but no relationship to the schedule: 404.
    const stranger = { id: 'u9', name: 'Sam', isAdmin: false } as never;
    await expect(svc.listRuns(stranger, 's1')).rejects.toMatchObject({
      code: 'SCHEDULE_NOT_FOUND',
    });

    // A recipient may read, and sees hasFile instead of the internal csvKey.
    const runs = await svc.listRuns(other, 's1');
    expect(runs).toEqual([{ id: 'r1', status: 'SUCCESS', hasFile: true }]);
    expect(prisma.reportRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ csvKey: true }) }),
    );
  });

  it('restricts run downloads to the owner, recipients and admins', async () => {
    const run = {
      id: 'r1',
      csvKey: 'reports/r1.csv',
      requestedById: 'u1',
      schedule: { createdById: 'u1', recipients: ['u2'] },
    };
    const prisma = mockPrisma(null);
    (prisma.reportRun.findUnique as jest.Mock).mockResolvedValue(run);
    const { service: svc } = service(prisma);

    const stranger = { id: 'u9', name: 'Sam', isAdmin: false } as never;
    await expect(svc.readRunCsv(stranger, 'r1')).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
    });
    await expect(svc.readRunCsv(other, 'r1')).resolves.toMatchObject({ filename: 'report-r1.csv' });
  });
});

describe('ReportsService reconcile drops orphan schedulers', () => {
  it('removes schedulers with no schedule row, keeps active ones and others’ jobs', async () => {
    const prisma = mockPrisma(null);
    (prisma.reportSchedule.findMany as jest.Mock).mockResolvedValue([
      { id: 's1', cron: '0 8 * * 1', timezone: 'Asia/Kolkata' },
    ]);
    const { service: svc, queue } = service(prisma);
    (queue.getJobSchedulers as jest.Mock).mockResolvedValue([
      { id: 'report-schedule-s1' },
      { id: 'report-schedule-gone' },
      { id: 'sla-timers' },
    ]);
    await svc.reconcile();
    expect(queue.removeJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith('report-schedule-gone');
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'report-schedule-s1',
      expect.anything(),
      expect.anything(),
    );
  });
});
