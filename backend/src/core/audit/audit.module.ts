import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';

/**
 * Session 15: read side of the audit trail plus retention management.
 * NOTE: the integration pass must add AuditModule to app.module.ts imports.
 */
@Module({
  controllers: [AuditController],
})
export class AuditModule {}
