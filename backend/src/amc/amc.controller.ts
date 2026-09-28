import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsString } from 'class-validator';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions, RequireRecentAuth } from '../auth/decorators';
import { AppSettingsService } from '../demo/app-settings.service';
import { AmcSchedulerService } from './amc-scheduler.service';
import { AmcService } from './amc.service';
import {
  AddPlannedVisitDto,
  AmcContractQueryDto,
  AmcVersionDto,
  CreateAmcContractDto,
  UpdateAmcContractDto,
} from './dto';

class EquipmentIdDto {
  @IsString()
  equipmentId!: string;
}

class UpdateAmcSettingsDto {
  @Type(() => Number)
  @IsInt()
  pmLeadTimeDays!: number;
}

/** AMC contracts, their planned visits, and the AMC scheduling settings. */
@Controller()
export class AmcController {
  constructor(
    private readonly amc: AmcService,
    private readonly scheduler: AmcSchedulerService,
    private readonly settings: AppSettingsService,
  ) {}

  @Get('amc')
  @RequirePermissions('amc.read')
  list(@Query() query: AmcContractQueryDto) {
    return this.amc.list(query);
  }

  @Get('amc/:id')
  @RequirePermissions('amc.read')
  get(@Param('id') id: string) {
    return this.amc.get(id);
  }

  @Post('amc')
  @RequirePermissions('amc.edit')
  create(
    @CurrentUser() actor: AuthUser,
    @Body() body: CreateAmcContractDto,
    @Client() client: ClientInfo,
  ) {
    return this.amc.create(actor, body, client);
  }

  @Patch('amc/:id')
  @RequirePermissions('amc.edit')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateAmcContractDto,
    @Client() client: ClientInfo,
  ) {
    return this.amc.update(actor, id, body, client);
  }

  @Post('amc/:id/activate')
  @RequirePermissions('amc.edit')
  @RequireRecentAuth()
  @HttpCode(HttpStatus.OK)
  activate(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: AmcVersionDto,
    @Client() client: ClientInfo,
  ) {
    return this.amc.activate(actor, id, body.version, client);
  }

  @Post('amc/:id/cancel')
  @RequirePermissions('amc.edit')
  @RequireRecentAuth()
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: AmcVersionDto,
    @Client() client: ClientInfo,
  ) {
    return this.amc.cancel(actor, id, body.version, client);
  }

  @Post('amc/:id/equipment')
  @RequirePermissions('amc.edit')
  addEquipment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: EquipmentIdDto,
    @Client() client: ClientInfo,
  ) {
    return this.amc.addEquipment(actor, id, body.equipmentId, client);
  }

  @Delete('amc/:id/equipment/:equipmentId')
  @RequirePermissions('amc.edit')
  removeEquipment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('equipmentId') equipmentId: string,
    @Client() client: ClientInfo,
  ) {
    return this.amc.removeEquipment(actor, id, equipmentId, client);
  }

  @Post('amc/:id/visits')
  @RequirePermissions('amc.edit')
  addPlannedVisit(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: AddPlannedVisitDto,
    @Client() client: ClientInfo,
  ) {
    return this.amc.addPlannedVisit(actor, id, body, client);
  }

  @Delete('amc/:id/visits/:visitId')
  @RequirePermissions('amc.edit')
  removePlannedVisit(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('visitId') visitId: string,
    @Client() client: ClientInfo,
  ) {
    return this.amc.removePlannedVisit(actor, id, visitId, client);
  }

  @Get('settings/app/amc')
  @RequirePermissions('company.read')
  amcSettings() {
    return this.settings.amc();
  }

  @Patch('settings/app/amc')
  @RequirePermissions('company.edit')
  @RequireRecentAuth()
  updateAmcSettings(
    @CurrentUser() actor: AuthUser,
    @Body() body: UpdateAmcSettingsDto,
    @Client() client: ClientInfo,
  ) {
    return this.settings.updateAmcSettings(actor, body, client);
  }

  /** Rebuilds every active contract's timers (used after an import or a Redis flush). */
  @Post('amc/admin/resync-timers')
  @RequirePermissions('company.edit')
  @RequireRecentAuth()
  @HttpCode(HttpStatus.OK)
  resyncTimers() {
    return this.scheduler.syncAll().then(() => ({ synced: true }));
  }
}
