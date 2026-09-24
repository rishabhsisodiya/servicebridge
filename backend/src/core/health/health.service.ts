import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { stripUrlCredentials } from '../logging/redact';
import { REDIS } from '../redis/redis.module';

export type CheckStatus = 'up' | 'down';

export interface DependencyCheck {
  status: CheckStatus;
  latencyMs: number;
  error?: string;
}

export interface ReadinessReport {
  status: 'ok' | 'error';
  checks: Record<'database' | 'redis', DependencyCheck>;
}

export const CHECK_TIMEOUT_MS = 2_000;

/** Resolves with the probe's result, or rejects once `ms` passes. */
export function withTimeout<T>(probe: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([probe, timeout]).finally(() => clearTimeout(timer));
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async readiness(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([
      this.check('database', () => this.prisma.$queryRaw`SELECT 1`),
      this.check('redis', () => this.redis.ping()),
    ]);
    const status = database.status === 'up' && redis.status === 'up' ? 'ok' : 'error';
    return { status, checks: { database, redis } };
  }

  private async check(name: string, probe: () => Promise<unknown>): Promise<DependencyCheck> {
    const started = performance.now();
    try {
      await withTimeout(probe(), CHECK_TIMEOUT_MS);
      return { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      const message = stripUrlCredentials(error instanceof Error ? error.message : String(error));
      this.logger.warn({ dependency: name, error: message }, 'Readiness check failed');
      // The public message stays generic; the detail is only in the server log.
      return {
        status: 'down',
        latencyMs: Math.round(performance.now() - started),
        error: message.includes('timed out') ? 'Timed out' : 'Unavailable',
      };
    }
  }
}
