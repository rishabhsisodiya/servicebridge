import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { CryptoService } from './crypto/crypto.service';
import { QueueService } from './queue/queue.service';
import { RateLimitService } from './rate-limit/rate-limit.service';

/** Cross-cutting services available everywhere. */
@Global()
@Module({
  providers: [AuditService, CryptoService, QueueService, RateLimitService],
  exports: [AuditService, CryptoService, QueueService, RateLimitService],
})
export class CoreModule {}
