import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { DutyStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions } from '../auth/decorators';
import { EngineersService } from './engineers.service';

class DutyDto {
  @IsEnum(DutyStatus, { message: 'Choose on duty, off duty or on leave.' })
  dutyStatus: DutyStatus;
}

@Controller('engineers')
export class EngineersController {
  constructor(private readonly engineers: EngineersService) {}

  /** Managers' view of engineers: duty, on visit, load and skills. */
  @Get()
  @RequirePermissions('tickets.assign')
  list(@CurrentUser() user: AuthUser) {
    return this.engineers.list(user);
  }

  @Get('me')
  @RequirePermissions('tickets.work')
  me(@CurrentUser() user: AuthUser) {
    return this.engineers.me(user.id);
  }

  /** An engineer sets their own status. */
  @Patch('me/duty')
  @RequirePermissions('tickets.work')
  setOwn(@CurrentUser() user: AuthUser, @Body() body: DutyDto, @Client() client: ClientInfo) {
    return this.engineers.setDuty(user, user.id, body.dutyStatus, client);
  }

  /** A manager sets an engineer's status (area managers: their own region only). */
  @Patch(':id/duty')
  @RequirePermissions('tickets.assign')
  set(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: DutyDto,
    @Client() client: ClientInfo,
  ) {
    return this.engineers.setDuty(user, id, body.dutyStatus, client);
  }
}
