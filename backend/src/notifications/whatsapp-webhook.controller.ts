import { Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { WhatsAppService } from './whatsapp.service';

/**
 * Called by Meta's WhatsApp Business platform. Public: authenticity comes from
 * the verify token (handshake) and the HMAC signature (receipts), not a
 * session. The admin registers the URL in the Meta app dashboard; see
 * WhatsAppService.webhookUrl().
 */
@Controller('settings/whatsapp/webhook')
export class WhatsAppWebhookController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  /** Meta's verification handshake: echo the challenge when the token matches. */
  @Public()
  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): Promise<string> {
    return this.whatsapp.verifyHandshake(mode, token, challenge);
  }

  /** Delivery receipts, signed with X-Hub-Signature-256. */
  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  receive(@Req() req: Request & { rawBody?: Buffer }): Promise<{ received: boolean }> {
    const signature = req.headers['x-hub-signature-256'];
    return this.whatsapp.receiveWebhook(
      req.rawBody,
      typeof signature === 'string' ? signature : undefined,
    );
  }
}
