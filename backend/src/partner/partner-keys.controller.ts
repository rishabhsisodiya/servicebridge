import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions, RequireRecentAuth } from '../auth/decorators';
import { CreatePartnerKeyDto, RevokePartnerKeyDto } from './dto';
import { PARTNER_EDIT, PARTNER_READ, PartnerKeyService } from './partner-key.service';

/** Admin UI for partner API keys. The raw key is returned exactly once, on create. */
@Controller('partner-keys')
export class PartnerKeysController {
  constructor(private readonly keys: PartnerKeyService) {}

  @Get()
  @RequirePermissions(PARTNER_READ)
  list() {
    return this.keys.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PARTNER_EDIT)
  @RequireRecentAuth()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreatePartnerKeyDto,
    @Client() client: ClientInfo,
  ) {
    const { key, rawKey } = await this.keys.create(user, body, client);
    // The only response that ever contains the raw key.
    return { ...key, key: rawKey };
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PARTNER_EDIT)
  @RequireRecentAuth()
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() _body: RevokePartnerKeyDto,
    @Client() client: ClientInfo,
  ) {
    return this.keys.revoke(user, id, client);
  }
}
