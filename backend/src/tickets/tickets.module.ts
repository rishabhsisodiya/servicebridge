import { Module } from '@nestjs/common';
import { AutomationsModule } from '../automations/automations.module';
import { DemoModule } from '../demo/demo.module';
import { ServiceRulesModule } from '../service-rules/service-rules.module';
import { DemoTicketsService } from './demo-tickets.service';
import { SlaTimersService } from './sla-timers.service';
import { TicketAttachmentsService } from './ticket-attachments.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [AutomationsModule, DemoModule, ServiceRulesModule],
  controllers: [TicketsController],
  providers: [TicketsService, SlaTimersService, TicketAttachmentsService, DemoTicketsService],
  exports: [TicketsService, SlaTimersService],
})
export class TicketsModule {}
