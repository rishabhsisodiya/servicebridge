import { Module } from '@nestjs/common';
import { DemoModule } from '../demo/demo.module';
import {
  RegionsController,
  ServiceRulesController,
  SkillsController,
} from './service-rules.controller';
import { RegionsService } from './regions.service';
import { ServiceRulesService } from './service-rules.service';
import { SkillsService } from './skills.service';

@Module({
  imports: [DemoModule],
  controllers: [ServiceRulesController, RegionsController, SkillsController],
  providers: [ServiceRulesService, RegionsService, SkillsService],
  exports: [ServiceRulesService, RegionsService, SkillsService],
})
export class ServiceRulesModule {}
