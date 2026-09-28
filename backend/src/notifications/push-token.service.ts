import { Injectable } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';

/**
 * Device push tokens. Registration only in this session: the mobile and web
 * clients store their FCM/APNs token here so a later session can deliver
 * pushes to it. Re-registering the same token moves it to the latest user.
 */
@Injectable()
export class PushTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, token: string, platform: 'android' | 'ios' | 'web') {
    await this.prisma.pushToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { userId, token, platform },
    });
    return { registered: true };
  }
}
