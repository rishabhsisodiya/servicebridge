import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions, RequireRecentAuth } from '../auth/decorators';
import { RolesService } from '../roles/roles.service';
import { InviteUserDto, ListUsersQuery, UpdateUserDto } from './dto';
import { UsersService } from './users.service';

@Controller('users')
@RequirePermissions('users.read')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly roles: RolesService,
  ) {}

  @Get()
  list(@Query() query: ListUsersQuery) {
    return this.users.list(query);
  }

  /** Role names for the invite and edit forms (people managing users may not see the Roles screen). */
  @Get('roles')
  roleOptions() {
    return this.roles.options();
  }

  @Post('invite')
  @RequirePermissions('users.create')
  invite(
    @CurrentUser() actor: AuthUser,
    @Body() body: InviteUserDto,
    @Client() client: ClientInfo,
  ) {
    return this.users.invite(actor, body, client);
  }

  @Patch(':id')
  @RequirePermissions('users.edit')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
    @Client() client: ClientInfo,
  ) {
    return this.users.update(actor, id, body, client);
  }

  @Post(':id/deactivate')
  @RequirePermissions('users.delete')
  deactivate(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Client() client: ClientInfo,
  ) {
    return this.users.setActive(actor, id, false, client);
  }

  @Post(':id/reactivate')
  @RequirePermissions('users.edit')
  reactivate(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Client() client: ClientInfo,
  ) {
    return this.users.setActive(actor, id, true, client);
  }

  @Post(':id/invite-link')
  @RequirePermissions('users.create')
  reissueInvite(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Client() client: ClientInfo,
  ) {
    return this.users.reissueInvite(actor, id, client);
  }

  /** A reset link lets whoever holds it take over the account, so it needs a fresh password check. */
  @Post(':id/reset-link')
  @RequirePermissions('users.edit')
  @RequireRecentAuth()
  resetLink(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Client() client: ClientInfo) {
    return this.users.issueResetLink(actor, id, client);
  }
}
