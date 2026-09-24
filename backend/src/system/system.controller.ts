import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions } from '../auth/decorators';
import { JOB_STATES, type JobState, SystemService } from './system.service';

class JobsQuery {
  @IsIn(JOB_STATES)
  state: JobState = 'failed';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
}

class CleanDto {
  @IsIn(['completed', 'failed'])
  state: 'completed' | 'failed';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  olderThanDays: number;
}

class RequestsQuery {
  @IsOptional()
  @IsString()
  connectionId?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  failedOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
}

@Controller('system')
@RequirePermissions('system.monitor')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('queues')
  queues() {
    return this.system.overview();
  }

  @Get('queues/:queue/jobs')
  jobs(@Param('queue') queue: string, @Query() query: JobsQuery) {
    return this.system.jobs(queue, query.state, query.page);
  }

  @Get('queues/:queue/jobs/:id')
  job(@Param('queue') queue: string, @Param('id') id: string) {
    return this.system.jobDetail(queue, id);
  }

  @Post('queues/:queue/jobs/:id/retry')
  @HttpCode(HttpStatus.NO_CONTENT)
  async retry(
    @CurrentUser() actor: AuthUser,
    @Param('queue') queue: string,
    @Param('id') id: string,
    @Client() client: ClientInfo,
  ) {
    await this.system.retry(actor, queue, id, client);
  }

  @Post('queues/:queue/jobs/:id/promote')
  @HttpCode(HttpStatus.NO_CONTENT)
  async promote(
    @CurrentUser() actor: AuthUser,
    @Param('queue') queue: string,
    @Param('id') id: string,
    @Client() client: ClientInfo,
  ) {
    await this.system.promote(actor, queue, id, client);
  }

  @Post('queues/:queue/jobs/:id/remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() actor: AuthUser,
    @Param('queue') queue: string,
    @Param('id') id: string,
    @Client() client: ClientInfo,
  ) {
    await this.system.remove(actor, queue, id, client);
  }

  @Post('queues/:queue/pause')
  @HttpCode(HttpStatus.NO_CONTENT)
  async pause(
    @CurrentUser() actor: AuthUser,
    @Param('queue') queue: string,
    @Client() client: ClientInfo,
  ) {
    await this.system.setPaused(actor, queue, true, client);
  }

  @Post('queues/:queue/resume')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resume(
    @CurrentUser() actor: AuthUser,
    @Param('queue') queue: string,
    @Client() client: ClientInfo,
  ) {
    await this.system.setPaused(actor, queue, false, client);
  }

  @Post('queues/:queue/retry-failed')
  @HttpCode(HttpStatus.OK)
  retryFailed(
    @CurrentUser() actor: AuthUser,
    @Param('queue') queue: string,
    @Client() client: ClientInfo,
  ) {
    return this.system.retryAllFailed(actor, queue, client);
  }

  @Post('queues/:queue/clean')
  @HttpCode(HttpStatus.OK)
  clean(
    @CurrentUser() actor: AuthUser,
    @Param('queue') queue: string,
    @Body() body: CleanDto,
    @Client() client: ClientInfo,
  ) {
    return this.system.clean(actor, queue, body.state, body.olderThanDays, client);
  }

  @Get('erp-requests')
  erpRequests(@Query() query: RequestsQuery) {
    return this.system.erpRequests({
      connectionId: query.connectionId,
      failedOnly: query.failedOnly,
      page: query.page,
    });
  }

  @Get('connections')
  connections() {
    return this.system.connectionHealth();
  }
}
