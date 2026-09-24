import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { PrismaService } from '../prisma/prisma.service';
import { HealthService, withTimeout } from './health.service';

const build = (db: () => Promise<unknown>, ping: () => Promise<unknown>) =>
  new HealthService({ $queryRaw: db } as unknown as PrismaService, { ping } as unknown as Redis);

describe('HealthService.readiness', () => {
  it('is ok when every dependency answers', async () => {
    const report = await build(
      () => Promise.resolve([{ '?column?': 1 }]),
      () => Promise.resolve('PONG'),
    ).readiness();
    expect(report.status).toBe('ok');
    expect(report.checks.database.status).toBe('up');
    expect(report.checks.redis.status).toBe('up');
  });

  it('reports which dependency is down without leaking driver detail', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const report = await build(
      () => Promise.reject(new Error('connect ECONNREFUSED postgres://sb:secret@db:5432')),
      () => Promise.resolve('PONG'),
    ).readiness();
    expect(report.status).toBe('error');
    expect(report.checks.database).toMatchObject({ status: 'down', error: 'Unavailable' });
    expect(JSON.stringify(report)).not.toContain('secret');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(warn.mock.calls)).toContain('ECONNREFUSED');
    warn.mockRestore();
    expect(report.checks.redis.status).toBe('up');
  });
});

describe('withTimeout', () => {
  it('rejects a probe that never settles', async () => {
    await expect(withTimeout(new Promise(() => undefined), 10)).rejects.toThrow('timed out');
  });
});
