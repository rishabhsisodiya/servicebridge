import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions, RequireRecentAuth } from '../auth/decorators';
import { AppSettingsService } from './app-settings.service';
import { DemoService } from './demo.service';

class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Enter the company name.' })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  gstRatePercent?: number;
}

class ClearDemoDto {
  @IsString()
  confirm: string;
}

@Controller()
export class DemoController {
  constructor(
    private readonly settings: AppSettingsService,
    private readonly demo: DemoService,
  ) {}

  /** Company settings and whether demo data is loaded. Any signed-in user (shown in the shell). */
  @Get('settings/app')
  async app() {
    const [company, demo] = await Promise.all([this.settings.company(), this.demo.status()]);
    return { company, demo: { active: demo.active } };
  }

  @Patch('settings/app/company')
  @RequirePermissions('settings.manage')
  updateCompany(
    @CurrentUser() actor: AuthUser,
    @Body() body: UpdateCompanyDto,
    @Client() client: ClientInfo,
  ) {
    return this.settings.updateCompany(
      actor,
      { ...body, currency: body.currency?.toUpperCase() },
      client,
    );
  }

  @Get('demo')
  @RequirePermissions('settings.manage')
  status() {
    return this.demo.status();
  }

  @Post('demo/load')
  @RequirePermissions('settings.manage')
  @RequireRecentAuth()
  @HttpCode(HttpStatus.OK)
  load(@CurrentUser() actor: AuthUser, @Client() client: ClientInfo) {
    return this.demo.load(actor, client.ip);
  }

  @Post('demo/clear')
  @RequirePermissions('settings.manage')
  @RequireRecentAuth()
  @HttpCode(HttpStatus.OK)
  clear(@CurrentUser() actor: AuthUser, @Body() body: ClearDemoDto, @Client() client: ClientInfo) {
    return this.demo.clear(actor, body.confirm, client.ip);
  }
}
