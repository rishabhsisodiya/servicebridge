import { Module } from '@nestjs/common';
import { AutomationsModule } from '../automations/automations.module';
import { DemoModule } from '../demo/demo.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServiceRulesModule } from '../service-rules/service-rules.module';
import { AutoAssignService } from './auto-assign.service';
import { DemoTicketsService } from './demo-tickets.service';
import { EngineersController } from './engineers.controller';
import { EngineersService } from './engineers.service';
import { SlaTimersService } from './sla-timers.service';
import { TicketAttachmentsService } from './ticket-attachments.service';
import { TicketNotifier } from './ticket-notifier';
import { TicketStatsService } from './ticket-stats.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [AutomationsModule, DemoModule, NotificationsModule, ServiceRulesModule],
  controllers: [TicketsController, EngineersController],
  providers: [
    TicketsService,
    SlaTimersService,
    TicketAttachmentsService,
    DemoTicketsService,
    EngineersService,
    TicketNotifier,
    AutoAssignService,
    TicketStatsService,
  ],
  exports: [TicketsService, SlaTimersService],
})
export class TicketsModule {}
