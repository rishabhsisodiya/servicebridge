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
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions, RequireRecentAuth } from '../auth/decorators';
import { CreateRoleDto, DeleteRoleQuery, UpdateRoleDto } from './dto';
import { RolesService } from './roles.service';

@Controller('roles')
@RequirePermissions('roles.read')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list() {
    return this.roles.list();
  }

  /** Record types, workflow actions and ticket scopes for the permission grid. */
  @Get('catalog')
  catalog() {
    return this.roles.catalog();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.roles.get(id);
  }

  @Post()
  @RequirePermissions('roles.create')
  @RequireRecentAuth()
  create(
    @CurrentUser() actor: AuthUser,
    @Body() body: CreateRoleDto,
    @Client() client: ClientInfo,
  ) {
    return this.roles.create(actor, body, client);
  }

  @Patch(':id')
  @RequirePermissions('roles.edit')
  @RequireRecentAuth()
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateRoleDto,
    @Client() client: ClientInfo,
  ) {
    return this.roles.update(actor, id, body, client);
  }

  @Delete(':id')
  @RequirePermissions('roles.delete')
  @RequireRecentAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Query() query: DeleteRoleQuery,
    @Client() client: ClientInfo,
  ) {
    return this.roles.remove(actor, id, query.version, client);
  }
}
