import { Module } from '@nestjs/common';
import { DemoModule } from '../../demo/demo.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ErpModule } from '../erp.module';
import { WritebacksController } from './writebacks.controller';
import { WritebacksService } from './writebacks.service';

/**
 * ERP write-backs. Imports ErpModule for the connections service; ErpModule
 * never imports back, so there is no cycle. TicketsModule and VisitsModule
 * import this module for the enqueue hooks.
 */
@Module({
  imports: [ErpModule, DemoModule, NotificationsModule],
  controllers: [WritebacksController],
  providers: [WritebacksService],
  exports: [WritebacksService],
})
export class WritebacksModule {}
