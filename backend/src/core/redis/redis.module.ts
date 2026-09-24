import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../config/app-config.service';

/** Shared client for app-level Redis use. BullMQ gets its own connections (session 5). */
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        new Redis(config.get('REDIS_URL'), {
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          enableOfflineQueue: true,
          // Back off up to 5 s between reconnect attempts; never give up.
          retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status !== 'end') {
      await this.redis.quit().catch(() => this.redis.disconnect());
    }
  }
}
