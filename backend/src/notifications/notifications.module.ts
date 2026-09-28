import { Module } from '@nestjs/common';
import { DemoModule } from '../demo/demo.module';
import { EmailService } from './email.service';
import { EmailSettingsController } from './email-settings.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushTokenService } from './push-token.service';

@Module({
  imports: [DemoModule],
  controllers: [NotificationsController, EmailSettingsController],
  providers: [NotificationsService, EmailService, PushTokenService],
  exports: [NotificationsService, EmailService, PushTokenService],
})
export class NotificationsModule {}
