import { Global, Module } from '@nestjs/common';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { Housekeeping } from './housekeeping';

/** Global so any feature module can define its automations with AutomationsService.define(). */
@Global()
@Module({
  controllers: [AutomationsController],
  providers: [AutomationsService, Housekeeping],
  exports: [AutomationsService],
})
export class AutomationsModule {}
