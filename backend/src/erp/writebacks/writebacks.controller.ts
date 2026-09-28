import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser, ClientInfo } from '../../auth/auth.types';
import { Client, CurrentUser, RequirePermissions, RequireRecentAuth } from '../../auth/decorators';
import { CreateWarehouseDto, UpdateWarehouseDto, UpdateWritebackSettingsDto } from './dto';
import { WritebacksService } from './writebacks.service';

/**
 * ERP write-back administration: setup check, settings, warehouses and the
 * write-back log. Reading needs `writebacks.read`; anything that changes
 * things needs `writebacks.edit`.
 */
@Controller('erp/writebacks')
@RequirePermissions('writebacks.read')
export class WritebacksController {
  constructor(private readonly writebacks: WritebacksService) {}

  /** Everything the admin UI needs on one screen. */
  @Get('overview')
  overview() {
    return this.writebacks.overview();
  }

  /** Write-back log, newest first (optionally for one ticket). */
  @Get()
  list(@Query('ticketId') ticketId?: string) {
    return this.writebacks.list(ticketId || undefined).then((data) => ({ data }));
  }

  /** Runs the read-only setup probe against the WRITEBACK connection. */
  @Post('setup-check')
  setupCheck() {
    return this.writebacks.setupCheck();
  }

  @Patch('settings')
  @RequirePermissions('writebacks.edit')
  @RequireRecentAuth()
  async updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateWritebackSettingsDto,
    @Client() client: ClientInfo,
  ) {
    const settings = await this.writebacks.updateSettings(user, dto, client);
    return { settings };
  }

  @Post(':id/retry')
  @RequirePermissions('writebacks.edit')
  retry(@CurrentUser() user: AuthUser, @Param('id') id: string, @Client() client: ClientInfo) {
    return this.writebacks.retry(user, id, client);
  }

  @Post('warehouses')
  @RequirePermissions('writebacks.edit')
  addWarehouse(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWarehouseDto,
    @Client() client: ClientInfo,
  ) {
    return this.writebacks.addWarehouse(user, dto.name, client);
  }

  @Patch('warehouses/:id')
  @RequirePermissions('writebacks.edit')
  updateWarehouse(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
    @Client() client: ClientInfo,
  ) {
    return this.writebacks.updateWarehouse(user, id, dto, client);
  }
}
