import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { RateLimitService } from './rate-limit.service';

/** Minimal in-memory stand-in for the MULTI INCR / EXPIRE NX / TTL sequence. */
function fakeRedis() {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();
  return {
    counts,
    multi() {
      const ops: (() => [null, number])[] = [];
      const chain = {
        incr: (k: string) => {
          ops.push(() => {
            counts.set(k, (counts.get(k) ?? 0) + 1);
            return [null, counts.get(k)!];
          });
          return chain;
        },
        expire: (k: string, seconds: number) => {
          ops.push(() => {
            if (!ttls.has(k)) ttls.set(k, seconds);
            return [null, 1];
          });
          return chain;
        },
        ttl: (k: string) => {
          ops.push(() => [null, ttls.get(k) ?? -1]);
          return chain;
        },
        exec: () => Promise.resolve(ops.map((op) => op())),
      };
      return chain;
    },
    del: (k: string) => {
      counts.delete(k);
      ttls.delete(k);
      return Promise.resolve(1);
    },
  };
}

describe('RateLimitService', () => {
  it('allows up to the limit, then refuses with a wait time', async () => {
    const service = new RateLimitService(fakeRedis() as unknown as Redis);
    for (let i = 0; i < 3; i += 1) {
      await expect(service.consume('login:a', 3, 60)).resolves.toMatchObject({ allowed: true });
    }
    await expect(service.consume('login:a', 3, 60)).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it('enforce() throws a 429 with a readable message', async () => {
    const service = new RateLimitService(fakeRedis() as unknown as Redis);
    await service.consume('k', 1, 120);
    await expect(service.enforce('k', 1, 120)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Try again in 2 minutes.',
    });
  });

  it('reset() clears the counter', async () => {
    const redis = fakeRedis();
    const service = new RateLimitService(redis as unknown as Redis);
    await service.consume('k', 1, 60);
    await service.reset('k');
    await expect(service.consume('k', 1, 60)).resolves.toMatchObject({ allowed: true });
  });

  it('fails open when Redis is unavailable', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const broken = {
      multi: () => ({
        incr: () => {
          throw new Error('ECONNREFUSED');
        },
      }),
    };
    const service = new RateLimitService(broken as unknown as Redis);
    await expect(service.consume('k', 1, 60)).resolves.toMatchObject({ allowed: true });
  });
});
