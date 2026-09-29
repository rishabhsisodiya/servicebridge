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

describe('AutomationsService.update params', () => {
  const actor = { id: 'u1', name: 'Mira' } as never;
  const client = { ip: '127.0.0.1', requestId: 'r1' } as never;

  function build(validateParams?: (p: Record<string, unknown>) => string[]) {
    const upsert = jest.fn().mockResolvedValue({ key: 'esc', enabled: true });
    const prisma = {
      automationSetting: {
        findUnique: jest.fn().mockResolvedValue({ key: 'esc', params: { afterMinutes: 60 } }),
        upsert,
      },
    };
    const audit = { record: jest.fn() };
    const service = new AutomationsService(
      prisma as unknown as PrismaService,
      { register: jest.fn() } as unknown as QueueService,
      audit as unknown as AuditService,
    );
    (service as unknown as { applySchedule: () => Promise<void> }).applySchedule = jest.fn();
    service.define(
      {
        key: 'esc',
        name: 'Esc',
        description: '',
        category: 'Service',
        queue: 'escalations',
        kind: 'event',
        defaultEnabled: false,
        validateParams,
      },
      jest.fn(),
    );
    return { service, upsert, audit };
  }

  it('merges new params over the stored ones and audits the change', async () => {
    const { service, upsert, audit } = build();
    await service.update(actor, 'esc', { params: { afterMinutes: 45 } }, client);
    expect(upsert.mock.calls[0][0].update.params).toEqual({ afterMinutes: 45 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'automation.updated' }),
    );
  });

  it('rejects invalid params before writing anything', async () => {
    const { service, upsert } = build(() => ['afterMinutes: too small']);
    await expect(
      service.update(actor, 'esc', { params: { afterMinutes: 3 } }, client),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('AutomationsService.list params', () => {
  function build(settings: unknown[]) {
    const prisma = {
      automationSetting: { findMany: jest.fn().mockResolvedValue(settings) },
      jobRun: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AutomationsService(
      prisma as unknown as PrismaService,
      { register: jest.fn() } as unknown as QueueService,
      { record: jest.fn() } as unknown as AuditService,
    );
    service.define(
      {
        key: 'esc',
        name: 'Esc',
        description: '',
        category: 'Service',
        queue: 'escalations',
        kind: 'event',
        defaultEnabled: false,
      },
      jest.fn(),
    );
    return service;
  }

  it('returns the stored params', async () => {
    const service = build([{ key: 'esc', enabled: true, params: { afterMinutes: 90 } }]);
    const [automation] = await service.list();
    expect(automation.params).toEqual({ afterMinutes: 90 });
  });

  it('returns empty params when nothing is stored, so the screen can fall back to defaults', async () => {
    const [automation] = await build([]).list();
    expect(automation.params).toEqual({});
  });
});
