import { Module } from '@nestjs/common';
import { AutomationsModule } from '../automations/automations.module';
import { DemoModule } from '../demo/demo.module';
import { TicketsModule } from '../tickets/tickets.module';
import { DemoQuotationsService } from './demo-quotations.service';
import { QuotationEvents } from './quotation-events';
import { QuotationExpiryService } from './quotation-expiry.service';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';

@Module({
  imports: [TicketsModule, AutomationsModule, DemoModule],
  controllers: [QuotationsController],
  providers: [QuotationsService, QuotationExpiryService, QuotationEvents, DemoQuotationsService],
  exports: [QuotationsService, QuotationEvents],
})
export class QuotationsModule {}
