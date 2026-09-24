import { Module } from '@nestjs/common';
import { AppSettingsService } from './app-settings.service';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

@Module({
  controllers: [DemoController],
  providers: [AppSettingsService, DemoService],
  exports: [AppSettingsService, DemoService],
})
export class DemoModule {}
