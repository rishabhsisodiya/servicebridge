import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions } from '../auth/decorators';
import { AutomationsService } from './automations.service';

class UpdateAutomationDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cron?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

class RunsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
}

@Controller('automations')
@RequirePermissions('automations.manage')
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get()
  list() {
    return this.automations.list();
  }

  @Patch(':key')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('key') key: string,
    @Body() body: UpdateAutomationDto,
    @Client() client: ClientInfo,
  ) {
    return this.automations.update(actor, key, body, client);
  }

  @Post(':key/run')
  @HttpCode(HttpStatus.ACCEPTED)
  run(@CurrentUser() actor: AuthUser, @Param('key') key: string, @Client() client: ClientInfo) {
    return this.automations.runNow(actor, key, client);
  }

  @Get(':key/runs')
  runs(@Param('key') key: string, @Query() query: RunsQuery) {
    return this.automations.runs(key, query.page);
  }
}
