import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { NotificationsService } from './notifications.service';
import { PushTokenService } from './push-token.service';

class MarkReadDto {
  /** Omit to mark everything read. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids?: string[];
}

class RegisterPushTokenDto {
  /** The device token from FCM/APNs. */
  @IsString()
  @MaxLength(512)
  token!: string;

  @IsIn(['android', 'ios', 'web'])
  platform!: 'android' | 'ios' | 'web';
}

/** The signed-in user's own notifications; no permission beyond being signed in. */
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly pushTokens: PushTokenService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user.id);
  }

  @Get('unread-count')
  async unread(@CurrentUser() user: AuthUser) {
    return { unread: await this.notifications.unreadCount(user.id) };
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  markRead(@CurrentUser() user: AuthUser, @Body() body: MarkReadDto) {
    return this.notifications.markRead(user.id, body.ids);
  }

  /**
   * Registers a device push token. Registration only: delivery rides a later
   * session; the token is stored so it is ready when that lands.
   */
  @Post('push-token')
  @HttpCode(HttpStatus.OK)
  registerPushToken(@CurrentUser() user: AuthUser, @Body() body: RegisterPushTokenDto) {
    return this.pushTokens.register(user.id, body.token.trim(), body.platform);
  }
}
