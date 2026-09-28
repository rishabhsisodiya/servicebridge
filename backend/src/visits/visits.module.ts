import { Module } from '@nestjs/common';
import { DemoModule } from '../demo/demo.module';
import { WritebacksModule } from '../erp/writebacks/writebacks.module';
import { TicketsModule } from '../tickets/tickets.module';
import { DemoVisitsService } from './demo-visits.service';
import { VisitEvents } from './visit-events';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  imports: [TicketsModule, WritebacksModule, DemoModule],
  controllers: [VisitsController],
  providers: [VisitsService, VisitEvents, DemoVisitsService],
  exports: [VisitsService, VisitEvents],
})
export class VisitsModule {}
