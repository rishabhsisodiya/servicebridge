import { Module } from '@nestjs/common';
import { AutomationsModule } from '../automations/automations.module';
import { DemoModule } from '../demo/demo.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AmcController } from './amc.controller';
import { AmcSchedulerService } from './amc-scheduler.service';
import { AmcService } from './amc.service';

@Module({
  imports: [AutomationsModule, DemoModule, NotificationsModule, TicketsModule],
  controllers: [AmcController],
  providers: [AmcService, AmcSchedulerService],
  exports: [AmcService, AmcSchedulerService],
})
export class AmcModule {}
