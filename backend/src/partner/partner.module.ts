import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { PartnerController } from './partner.controller';
import { PartnerKeysController } from './partner-keys.controller';
import { PartnerGuard } from './partner.guard';
import { PartnerKeyService } from './partner-key.service';
import { PartnerService } from './partner.service';

/**
 * Session 15: partner API (key-authenticated ticket logging) and the admin
 * UI for API keys.
 * NOTE: the integration pass must add PartnerModule to app.module.ts imports.
 */
@Module({
  imports: [TicketsModule],
  controllers: [PartnerController, PartnerKeysController],
  providers: [PartnerGuard, PartnerKeyService, PartnerService],
  exports: [PartnerKeyService],
})
export class PartnerModule {}
