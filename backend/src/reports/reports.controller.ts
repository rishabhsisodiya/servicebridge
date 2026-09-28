import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions } from '../auth/decorators';
import { CSV_BOM, toCsv } from './csv';
import { KpiService } from './kpi.service';
import { ReportsService } from './reports.service';

class RunReportDto {
  @IsOptional()
  @IsObject()
  params?: Record<string, string>;
}

class CreateScheduleDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  reportKey!: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, string>;

  @IsString()
  @MaxLength(64)
  cron!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsString({ each: true })
  recipients!: string[];
}

class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  reportKey?: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cron?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString({ each: true })
  recipients?: string[];

  @IsInt()
  @Min(1)
  version!: number;
}

class KpiQuery {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

class RunsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
}

@Controller('reports')
@RequirePermissions('reports.read')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly kpi: KpiService,
  ) {}

  /** The report catalog with parameter definitions. */
  @Get()
  catalog() {
    return this.reports.catalog();
  }

  /** Runs a report on demand: CSV downloads, JSON previews the first 100 rows. */
  @Post(':key/run')
  @HttpCode(HttpStatus.OK)
  async run(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Query('format') format: string | undefined,
    @Body() body: RunReportDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reports.runOnDemand(user, key, body.params ?? {});
    if (format === 'json') {
      return {
        reportKey: result.reportKey,
        label: result.label,
        columns: result.columns,
        rows: result.rows.slice(0, 100),
        total: result.rows.length,
        truncated: result.truncated,
        summary: result.summary,
      };
    }
    const csv = CSV_BOM + toCsv(result.columns, result.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.reportKey}.csv"`);
    return new StreamableFile(Buffer.from(csv, 'utf8'));
  }

  /** KPI matrix: service KPIs against targets, by region. */
  @Get('kpi')
  kpiMatrix(@CurrentUser() user: AuthUser, @Query() query: KpiQuery) {
    return this.reports.kpiMatrix(user, { from: query.from, to: query.to });
  }

  /** Current KPI targets (global + regional overrides). */
  @Get('kpi/targets')
  kpiTargets() {
    return this.reports.getKpiTargets();
  }

  /** Replaces the KPI targets; audited. */
  @Patch('kpi/targets')
  @RequirePermissions('reports.schedule')
  updateKpiTargets(
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
    @Body() body: Record<string, { target: number; regions?: Record<string, number> }>,
  ) {
    return this.reports.updateKpiTargets(actor, body, client);
  }
}

@Controller('report-schedules')
@RequirePermissions('reports.schedule')
export class ReportSchedulesController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list() {
    return this.reports.listSchedules();
  }

  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
    @Body() body: CreateScheduleDto,
  ) {
    return this.reports.createSchedule(actor, body, client);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.reports.getSchedule(id);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
    @Param('id') id: string,
    @Body() body: UpdateScheduleDto,
  ) {
    return this.reports.updateSchedule(actor, id, body, client);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
    @Param('id') id: string,
  ): Promise<void> {
    await this.reports.deleteSchedule(actor, id, client);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id') id: string) {
    return this.reports.activate(id).then(() => ({ ok: true }));
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id') id: string) {
    return this.reports.deactivate(id).then(() => ({ ok: true }));
  }

  @Get(':id/runs')
  runs(@Param('id') id: string, @Query() query: RunsQuery) {
    return this.reports.listRuns(id, query.page);
  }
}

@Controller('report-runs')
@RequirePermissions('reports.schedule')
export class ReportRunsController {
  constructor(private readonly reports: ReportsService) {}

  /** Downloads the CSV stored for a run (scheduled runs keep their file). */
  @Get(':id/download')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async download(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { stream, filename } = await this.reports.readRunCsv(id);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(stream);
  }
}
