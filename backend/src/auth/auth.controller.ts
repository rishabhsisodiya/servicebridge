import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppConfig } from '../core/config/app-config.service';
import { AuthService, type SignedIn } from './auth.service';
import type { AuthUser, ClientInfo, MeResponse } from './auth.types';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './cookies';
import { type AuthedRequest, Client, CurrentUser, Public } from './decorators';
import { ChangePasswordDto, LoginDto, PasswordDto, UpdateProfileDto } from './dto';
import { sessionEnded } from './sessions.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  private get secureCookies(): boolean {
    return this.config.get('APP_URL').startsWith('https://');
  }

  private issue(res: Response, signedIn: SignedIn): MeResponse {
    setAuthCookies(
      res,
      { access: signedIn.accessToken, refresh: signedIn.refreshToken },
      {
        secure: this.secureCookies,
        accessTtlSeconds: this.config.get('ACCESS_TOKEN_TTL_SECONDS'),
        refreshTtlSeconds: this.config.get('SESSION_IDLE_DAYS') * 86_400,
      },
    );
    return signedIn.me;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.issue(res, await this.auth.login(body.email, body.password, client));
  }

  /** Swaps the refresh cookie for a new access token (and usually a new refresh token). */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: AuthedRequest,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    try {
      if (!token) throw sessionEnded();
      return this.issue(res, await this.auth.refresh(token, client));
    } catch (error) {
      // Clear stale cookies so the web app's sign-in redirect can't loop.
      clearAuthCookies(res, this.secureCookies);
      throw error;
    }
  }

  /** Public so a user whose access token already expired can still sign out. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutByRefreshToken(
      (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE],
    );
    clearAuthCookies(res, this.secureCookies);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.me(user.id);
  }

  @Patch('me')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateProfileDto,
    @Client() client: ClientInfo,
  ) {
    return this.auth.updateProfile(user, body.name, client);
  }

  @Post('confirm-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmPassword(@CurrentUser() user: AuthUser, @Body() body: PasswordDto): Promise<void> {
    await this.auth.confirmPassword(user, body.password);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: ChangePasswordDto,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword, client);
  }

  @Post('sessions/revoke-others')
  async signOutOtherDevices(@CurrentUser() user: AuthUser, @Client() client: ClientInfo) {
    return { signedOut: await this.auth.signOutOtherDevices(user, client) };
  }

  @Public()
  @Get('links/:token')
  describeLink(@Param('token') token: string) {
    return this.auth.describeLink(token);
  }

  @Public()
  @Post('links/:token/accept')
  @HttpCode(HttpStatus.OK)
  async acceptLink(
    @Param('token') token: string,
    @Body() body: PasswordDto,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.issue(res, await this.auth.acceptLink(token, body.password, client));
  }
}
