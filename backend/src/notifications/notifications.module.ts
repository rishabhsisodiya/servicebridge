import { Module } from '@nestjs/common';
import { DemoModule } from '../demo/demo.module';
import { EmailService } from './email.service';
import { EmailSettingsController } from './email-settings.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushTokenService } from './push-token.service';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppSettingsController } from './whatsapp-settings.controller';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [DemoModule],
  controllers: [
    NotificationsController,
    EmailSettingsController,
    WhatsAppSettingsController,
    WhatsAppWebhookController,
  ],
  providers: [NotificationsService, EmailService, PushTokenService, WhatsAppService],
  exports: [NotificationsService, EmailService, PushTokenService, WhatsAppService],
})
export class NotificationsModule {}
