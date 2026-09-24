import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import type { Request } from 'express';
import type { AuthUser, ClientInfo } from '../../auth/auth.types';
import {
  Client,
  CurrentUser,
  Public,
  RequirePermissions,
  RequireRecentAuth,
} from '../../auth/decorators';
import { ErpWebhooksService } from './erp-webhooks.service';

class WebhookEventsQuery {
  @IsOptional()
  @IsIn(['QUEUED', 'PROCESSED', 'IGNORED', 'REJECTED', 'FAILED'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
}

/** Called by ERPNext. Public: authenticity comes from the HMAC signature, not a session. */
@Controller('erp/webhooks')
export class ErpWebhookReceiverController {
  constructor(private readonly webhooks: ErpWebhooksService) {}

  @Public()
  @Post(':connectionId')
  @HttpCode(HttpStatus.ACCEPTED)
  receive(@Param('connectionId') connectionId: string, @Req() req: Request & { rawBody?: Buffer }) {
    const signature = req.headers['x-frappe-webhook-signature'];
    return this.webhooks.receive(
      connectionId,
      req.rawBody,
      typeof signature === 'string' ? signature : undefined,
    );
  }
}

@Controller()
export class ErpWebhookAdminController {
  constructor(private readonly webhooks: ErpWebhooksService) {}

  @Get('erp/connections/:id/webhooks')
  @RequirePermissions('erp.manage')
  setup(@Param('id') id: string) {
    return this.webhooks.setupInfo(id);
  }

  @Post('erp/connections/:id/webhooks/secret')
  @RequirePermissions('erp.manage')
  @RequireRecentAuth()
  @HttpCode(HttpStatus.OK)
  rotateSecret(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Client() client: ClientInfo,
  ) {
    return this.webhooks.rotateSecret(actor, id, client);
  }

  @Post('erp/connections/:id/webhooks/create-in-erp')
  @RequirePermissions('erp.manage')
  @RequireRecentAuth()
  @HttpCode(HttpStatus.OK)
  createInErp(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Client() client: ClientInfo,
  ) {
    return this.webhooks.createInErp(actor, id, client);
  }

  @Get('system/webhooks')
  @RequirePermissions('system.monitor')
  list(@Query() query: WebhookEventsQuery) {
    return this.webhooks.list({ status: query.status, page: query.page });
  }

  @Post('system/webhooks/:id/reprocess')
  @RequirePermissions('system.monitor')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reprocess(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Client() client: ClientInfo,
  ) {
    await this.webhooks.reprocess(actor, id, client);
  }
}
