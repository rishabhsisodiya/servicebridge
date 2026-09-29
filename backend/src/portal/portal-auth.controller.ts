import { Body, Controller, Get, HttpStatus, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Client, Public } from '../auth/decorators';
import type { ClientInfo } from '../auth/auth.types';
import { AppConfig } from '../core/config/app-config.service';
import { AppException } from '../core/http/app.exception';
import { RequestPortalLinkDto } from './dto';
import { PortalAuthService } from './portal-auth.service';
import {
  clearPortalCookies,
  CurrentCustomer,
  PORTAL_ACCESS_COOKIE,
  PORTAL_REFRESH_COOKIE,
  PortalGuard,
  secureCookies,
  setPortalCookies,
  unauthorized,
  type CustomerIdentity,
} from './portal.guard';

@Controller('portal')
export class PortalAuthController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('auth/request-link')
  requestLink(@Body() dto: RequestPortalLinkDto, @Client() client: ClientInfo) {
    return this.auth.requestLink(dto.email, client);
  }

  @Public()
  @Get('auth/verify')
  async verify(
    @Query('token') token: string,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!token || typeof token !== 'string') {
      throw new AppException(
        'PORTAL_LINK_INVALID',
        'This sign-in link is invalid or has expired. Request a new one.',
        HttpStatus.GONE,
      );
    }
    const { token: sessionToken } = await this.auth.verify(token, client);
    setPortalCookies(res, sessionToken, secureCookies(this.config));
    return { ok: true };
  }

  @Public()
  @UseGuards(PortalGuard)
  @Get('me')
  me(@CurrentCustomer() customer: CustomerIdentity) {
    return this.auth.me(customer);
  }

  @Public()
  @Post('auth/refresh')
  async refresh(@Req() req: { cookies?: Record<string, string> }, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[PORTAL_REFRESH_COOKIE];
    if (!token) throw unauthorized();
    const { token: next } = await this.auth.refresh(token);
    setPortalCookies(res, next, secureCookies(this.config));
    return { ok: true };
  }

  @Public()
  @Post('auth/logout')
  async logout(@Req() req: { cookies?: Record<string, string> }, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[PORTAL_ACCESS_COOKIE] ?? req.cookies?.[PORTAL_REFRESH_COOKIE];
    if (token) await this.auth.logout(token);
    clearPortalCookies(res, secureCookies(this.config));
    return { ok: true };
  }
}
