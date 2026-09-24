import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { AuditService } from '../core/audit/audit.service';
import type { PrismaService } from '../core/prisma/prisma.service';
import type { QueueService } from '../core/queue/queue.service';
import { recoveryDelay } from '../erp/connection-recovery';
import { safeJobData } from '../system/system.service';
import { type AutomationJobData, AutomationsService, cronProblem } from './automations.service';

describe('cronProblem', () => {
  it('accepts a sensible schedule', () => {
    expect(cronProblem('0 3 * * 0', 'Asia/Kolkata')).toBeUndefined();
  });

  it.each([
    ['* * * * *', 5, /at least 5 minutes/],
    ['*/30 * * * *', 60, /at least 60 minutes/],
    ['0 3 * *', 5, /Use 5 parts/],
    ['0 25 * * *', 5, /not a valid/],
  ])('rejects %p (min %i min)', (cron, min, problem) => {
    expect(cronProblem(cron, 'Asia/Kolkata', min)).toMatch(problem);
  });
});

describe('recoveryDelay', () => {
  it('backs off 1, 5, 15 minutes, then hourly', () => {
    expect([1, 2, 3, 4, 9].map((attempt) => recoveryDelay(attempt) / 60_000)).toEqual([
      1, 5, 15, 60, 60,
    ]);
  });
});

describe('safeJobData', () => {
  it('hides secret-looking fields and shortens long values', () => {
    expect(safeJobData({ connectionId: 'c1', apiSecret: 'x', note: 'a'.repeat(300) })).toEqual({
      connectionId: 'c1',
      apiSecret: '[hidden]',
      note: `${'a'.repeat(200)}…`,
    });
  });
});

describe('AutomationsService.execute', () => {
  function build(enabled: boolean) {
    const prisma = {
      automationSetting: { findUnique: jest.fn().mockResolvedValue({ enabled, params: {} }) },
      jobRun: {
        create: jest.fn().mockResolvedValue({ id: 'run1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const queues = { register: jest.fn() };
    const service = new AutomationsService(
      prisma as unknown as PrismaService,
      queues as unknown as QueueService,
      {} as AuditService,
    );
    const handler = jest.fn().mockResolvedValue('Did the thing');
    service.define(
      {
        key: 'x',
        name: 'X',
        description: '',
        category: 'Maintenance',
        queue: 'system',
        kind: 'periodic',
        defaultEnabled: true,
      },
      handler,
    );
    const job = (trigger: string) =>
      ({
        id: 'j1',
        data: { automationKey: 'x', trigger },
        log: jest.fn(),
      }) as unknown as Job<AutomationJobData>;
    return { service, prisma, handler, queues, job };
  }

  beforeAll(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));

  it('registers a worker handler for each automation', () => {
    const { queues } = build(true);
    expect(queues.register).toHaveBeenCalledWith('system', 'x', expect.any(Function));
  });

  it('runs and records a success with the summary', async () => {
    const { service, prisma, handler, job } = build(true);
    await expect(service.execute('x', job('SCHEDULE'))).resolves.toBe('Did the thing');
    expect(handler).toHaveBeenCalled();
    expect(prisma.jobRun.update.mock.calls[0][0].data).toMatchObject({
      status: 'SUCCEEDED',
      summary: 'Did the thing',
    });
  });

  it('skips scheduled and event runs while switched off, but allows Run now', async () => {
    const { service, prisma, handler, job } = build(false);
    await service.execute('x', job('SCHEDULE'));
    await service.execute('x', job('EVENT'));
    expect(handler).not.toHaveBeenCalled();
    expect(prisma.jobRun.create.mock.calls[0][0].data.status).toBe('SKIPPED');
    await service.execute('x', job('MANUAL'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('records a failure without credentials and rethrows so BullMQ can retry', async () => {
    const { service, prisma, handler, job } = build(true);
    handler.mockRejectedValue(new Error('connect failed mysql://ro:pw@db:3306/erp'));
    await expect(service.execute('x', job('SCHEDULE'))).rejects.toThrow('connect failed');
    const data = prisma.jobRun.update.mock.calls[0][0].data;
    expect(data.status).toBe('FAILED');
    expect(data.error).not.toContain(':pw@');
  });
});
