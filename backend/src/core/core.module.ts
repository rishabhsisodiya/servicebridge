import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { CryptoService } from './crypto/crypto.service';
import { RateLimitService } from './rate-limit/rate-limit.service';

/** Cross-cutting services available everywhere. */
@Global()
@Module({
  providers: [AuditService, CryptoService, RateLimitService],
  exports: [AuditService, CryptoService, RateLimitService],
})
export class CoreModule {}
