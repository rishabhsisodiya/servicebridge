import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { AppException } from '../http/app.exception';
import { REDIS } from '../redis/redis.module';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter in Redis. Shared by every API instance, so limits hold
 * when the API is scaled out.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const redisKey = `rl:${key}`;
    try {
      const results = await this.redis
        .multi()
        .incr(redisKey)
        .expire(redisKey, windowSeconds, 'NX')
        .ttl(redisKey)
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      const ttl = Number(results?.[2]?.[1] ?? windowSeconds);
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
      };
    } catch (error) {
      // Fail open: a Redis outage must not lock everyone out. Account lockout
      // (stored in Postgres) still protects against password guessing.
      this.logger.warn({ key, error: (error as Error).message }, 'Rate limiter unavailable');
      return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
    }
  }

  /** Consumes and throws 429 with a human-readable wait time when over the limit. */
  async enforce(key: string, limit: number, windowSeconds: number): Promise<void> {
    const result = await this.consume(key, limit, windowSeconds);
    if (!result.allowed) {
      const minutes = Math.ceil(result.retryAfterSeconds / 60);
      throw new AppException(
        'RATE_LIMITED',
        `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`rl:${key}`).catch(() => undefined);
  }
}
