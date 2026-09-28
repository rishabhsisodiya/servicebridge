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
  Put,
} from '@nestjs/common';
import type { AuthUser, ClientInfo } from '../../auth/auth.types';
import { Client, CurrentUser, RequirePermissions, RequireRecentAuth } from '../../auth/decorators';
import { ConnectionInputDto, SetPurposesDto, TestDraftDto, UpdateConnectionDto } from './dto';
import { ErpConnectionsService, PURPOSE_LABELS } from './erp-connections.service';

@Controller('erp')
@RequirePermissions('erp.read')
export class ErpConnectionsController {
  constructor(private readonly connections: ErpConnectionsService) {}

  @Get('connections')
  list() {
    return this.connections.list();
  }

  /** Saving credentials needs a fresh password check (decision: re-auth before credential changes). */
  @Post('connections')
  @RequirePermissions('erp.edit')
  @RequireRecentAuth()
  create(
    @CurrentUser() actor: AuthUser,
    @Body() body: ConnectionInputDto,
    @Client() client: ClientInfo,
  ) {
    return this.connections.create(actor, body, client);
  }

  @Patch('connections/:id')
  @RequirePermissions('erp.edit')
  @RequireRecentAuth()
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateConnectionDto,
    @Client() client: ClientInfo,
  ) {
    return this.connections.update(actor, id, body, client);
  }

  /** Tests details from the form without saving them. */
  @Post('connections/test')
  @RequirePermissions('erp.edit')
  @HttpCode(HttpStatus.OK)
  testDraft(@CurrentUser() actor: AuthUser, @Body() body: TestDraftDto) {
    return this.connections.testDraft(actor, body);
  }

  /** Saved secrets for the edit form; POST so it is never cached or prefetched. */
  @Post('connections/:id/reveal')
  @RequirePermissions('erp.edit')
  @HttpCode(HttpStatus.OK)
  @RequireRecentAuth()
  reveal(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Client() client: ClientInfo) {
    return this.connections.revealCredentials(actor, id, client);
  }

  @Post('connections/:id/test')
  @RequirePermissions('erp.edit')
  @HttpCode(HttpStatus.OK)
  test(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Client() client: ClientInfo) {
    return this.connections.testSaved(actor, id, client);
  }

  @Post('connections/:id/enable')
  @RequirePermissions('erp.edit')
  @HttpCode(HttpStatus.OK)
  enable(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Client() client: ClientInfo) {
    return this.connections.setEnabled(actor, id, true, client);
  }

  @Post('connections/:id/disable')
  @RequirePermissions('erp.edit')
  @HttpCode(HttpStatus.OK)
  disable(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Client() client: ClientInfo) {
    return this.connections.setEnabled(actor, id, false, client);
  }

  @Delete('connections/:id')
  @RequirePermissions('erp.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Client() client: ClientInfo,
  ) {
    await this.connections.remove(actor, id, client);
  }

  @Get('purposes')
  async purposes() {
    return { assignments: await this.connections.purposes(), labels: PURPOSE_LABELS };
  }

  @Put('purposes')
  @RequirePermissions('erp.edit')
  async setPurposes(
    @CurrentUser() actor: AuthUser,
    @Body() body: SetPurposesDto,
    @Client() client: ClientInfo,
  ) {
    return {
      assignments: await this.connections.setPurposes(actor, body, client),
      labels: PURPOSE_LABELS,
    };
  }
}
