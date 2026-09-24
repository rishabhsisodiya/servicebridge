import { Body, Controller, Get, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions, RequireRecentAuth } from '../auth/decorators';
import { ROLE_LABELS } from '../auth/permissions';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { CreateRegionDto, InviteUserDto, ListUsersQuery, UpdateUserDto } from './dto';
import { UsersService } from './users.service';

@Controller('users')
@RequirePermissions('users.manage')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() query: ListUsersQuery) {
    return this.users.list(query);
  }

  /** Roles and their labels, for the invite and edit forms. */
  @Get('roles')
  roles() {
    return Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));
  }

  @Post('invite')
  invite(
    @CurrentUser() actor: AuthUser,
    @Body() body: InviteUserDto,
    @Client() client: ClientInfo,
  ) {
    return this.users.invite(actor, body, client);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
    @Client() client: ClientInfo,
  ) {
    return this.users.update(actor, id, body, client);
  }

  @Post(':id/deactivate')
  deactivate(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Client() client: ClientInfo,
  ) {
    return this.users.setActive(actor, id, false, client);
  }

  @Post(':id/reactivate')
  reactivate(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Client() client: ClientInfo,
  ) {
    return this.users.setActive(actor, id, true, client);
  }

  @Post(':id/invite-link')
  reissueInvite(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Client() client: ClientInfo,
  ) {
    return this.users.reissueInvite(actor, id, client);
  }

  /** A reset link lets whoever holds it take over the account, so it needs a fresh password check. */
  @Post(':id/reset-link')
  @RequireRecentAuth()
  resetLink(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Client() client: ClientInfo) {
    return this.users.issueResetLink(actor, id, client);
  }
}

@Controller('regions')
export class RegionsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Any signed-in user may read regions (used in forms and filters). */
  @Get()
  list() {
    return this.prisma.region.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  @Post()
  @RequirePermissions('settings.manage')
  async create(@Body() body: CreateRegionDto) {
    try {
      return await this.prisma.region.create({
        data: { name: body.name.trim() },
        select: { id: true, name: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(
          'REGION_EXISTS',
          'A region with that name already exists.',
          HttpStatus.CONFLICT,
          [{ field: 'name', message: 'A region with that name already exists.' }],
        );
      }
      throw error;
    }
  }
}
