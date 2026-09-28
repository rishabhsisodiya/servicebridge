import { Module } from '@nestjs/common';
import { DemoModule } from '../demo/demo.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { KpiService } from './kpi.service';
import {
  ReportRunsController,
  ReportSchedulesController,
  ReportsController,
} from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Session 14: report catalog + runner, KPI matrix, scheduled report delivery.
 * Registers the `run-report` handler on the existing `reports` queue; the
 * repeatable per-schedule jobs are synced from the ReportSchedule rows.
 */
@Module({
  imports: [DemoModule, NotificationsModule],
  controllers: [ReportsController, ReportSchedulesController, ReportRunsController],
  providers: [ReportsService, KpiService],
  exports: [ReportsService],
})
export class ReportsModule {}
