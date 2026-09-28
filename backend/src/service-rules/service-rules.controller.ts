import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { TicketPriority, TicketStage } from '@prisma/client';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions } from '../auth/decorators';
import {
  BillingRateDto,
  CalendarDto,
  CreateServiceTypeDto,
  PriceListsDto,
  RegionDto,
  ResolvePincodeQuery,
  SkillDto,
  UpdateBillingRateDto,
  UpdateCalendarDto,
  UpdateLabelDto,
  UpdateRegionDto,
  UpdateServiceTypeDto,
  UpdateSkillDto,
  UpdateSlaPolicyDto,
} from './dto';
import { RegionsService } from './regions.service';
import { ServiceRulesService } from './service-rules.service';
import { SkillsService } from './skills.service';

@Controller('service-rules')
@RequirePermissions('rules.read')
export class ServiceRulesController {
  constructor(private readonly rules: ServiceRulesService) {}

  @Get('priorities')
  priorities() {
    return this.rules.priorities();
  }

  @Patch('priorities/:priority')
  @RequirePermissions('rules.edit')
  updatePriority(
    @Param('priority', new ParseEnumPipe(TicketPriority)) priority: TicketPriority,
    @Body() body: UpdateLabelDto,
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
  ) {
    return this.rules.updatePriority(priority, body, { actor, client });
  }

  @Get('stages')
  stages() {
    return this.rules.stages();
  }

  @Patch('stages/:stage')
  @RequirePermissions('rules.edit')
  updateStage(
    @Param('stage', new ParseEnumPipe(TicketStage)) stage: TicketStage,
    @Body() body: UpdateLabelDto,
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
  ) {
    return this.rules.updateStage(stage, body, { actor, client });
  }

  @Get('service-types')
  serviceTypes() {
    return this.rules.serviceTypes();
  }

  @Post('service-types')
  @RequirePermissions('rules.edit')
  createServiceType(
    @Body() body: CreateServiceTypeDto,
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
  ) {
    return this.rules.createServiceType(body, { actor, client });
  }

  @Patch('service-types/:id')
  @RequirePermissions('rules.edit')
  updateServiceType(
    @Param('id') id: string,
    @Body() body: UpdateServiceTypeDto,
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
  ) {
    return this.rules.updateServiceType(id, body, { actor, client });
  }

  @Get('sla')
  sla() {
    return this.rules.sla();
  }

  @Patch('sla/:id')
  @RequirePermissions('rules.edit')
  updateSla(
    @Param('id') id: string,
    @Body() body: UpdateSlaPolicyDto,
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
  ) {
    return this.rules.updateSlaPolicy(id, body, { actor, client });
  }

  @Post('calendars')
  @RequirePermissions('rules.edit')
  createCalendar(
    @Body() body: CalendarDto,
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
  ) {
    return this.rules.createCalendar(body, { actor, client });
  }

  @Patch('calendars/:id')
  @RequirePermissions('rules.edit')
  updateCalendar(
    @Param('id') id: string,
    @Body() body: UpdateCalendarDto,
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
  ) {
    return this.rules.updateCalendar(id, body, { actor, client });
  }

  @Delete('calendars/:id')
  @RequirePermissions('rules.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCalendar(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
  ) {
    return this.rules.deleteCalendar(id, { actor, client });
  }

  @Get('billing')
  billing() {
    return this.rules.billing();
  }

  @Put('billing/price-lists')
  @RequirePermissions('rules.edit')
  setPriceLists(
    @Body() body: PriceListsDto,
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
  ) {
    return this.rules.setPriceLists(body, { actor, client });
  }

  @Post('billing/rates')
  @RequirePermissions('rules.edit')
  createRate(
    @Body() body: BillingRateDto,
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
  ) {
    return this.rules.createBillingRate(body, { actor, client });
  }

  @Patch('billing/rates/:id')
  @RequirePermissions('rules.edit')
  updateRate(
    @Param('id') id: string,
    @Body() body: UpdateBillingRateDto,
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
  ) {
    return this.rules.updateBillingRate(id, body, { actor, client });
  }
}

@Controller('regions')
export class RegionsController {
  constructor(private readonly regions: RegionsService) {}

  /** Any signed-in user may read the names (used in forms and filters). */
  @Get()
  options() {
    return this.regions.options();
  }

  @Get('manage')
  @RequirePermissions('rules.read')
  list() {
    return this.regions.list();
  }

  @Get('managers')
  @RequirePermissions('rules.read')
  managers() {
    return this.regions.managers();
  }

  @Get('resolve')
  @RequirePermissions('rules.read')
  resolve(@Query() query: ResolvePincodeQuery) {
    return this.regions.resolve(query.pincode);
  }

  @Post()
  @RequirePermissions('rules.edit')
  create(@Body() body: RegionDto, @CurrentUser() actor: AuthUser, @Client() client: ClientInfo) {
    return this.regions.create(body, { actor, client });
  }

  @Patch(':id')
  @RequirePermissions('rules.edit')
  update(
    @Param('id') id: string,
    @Body() body: UpdateRegionDto,
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
  ) {
    return this.regions.update(id, body, { actor, client });
  }

  @Delete(':id')
  @RequirePermissions('rules.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser, @Client() client: ClientInfo) {
    return this.regions.remove(id, { actor, client });
  }
}

@Controller('skills')
@RequirePermissions('rules.read')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  list() {
    return this.skills.list();
  }

  @Get('options')
  options() {
    return this.skills.options();
  }

  @Post()
  @RequirePermissions('rules.edit')
  create(@Body() body: SkillDto, @CurrentUser() actor: AuthUser, @Client() client: ClientInfo) {
    return this.skills.create(body, { actor, client });
  }

  @Patch(':id')
  @RequirePermissions('rules.edit')
  update(
    @Param('id') id: string,
    @Body() body: UpdateSkillDto,
    @CurrentUser() actor: AuthUser,
    @Client() client: ClientInfo,
  ) {
    return this.skills.update(id, body, { actor, client });
  }

  @Delete(':id')
  @RequirePermissions('rules.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser, @Client() client: ClientInfo) {
    return this.skills.remove(id, { actor, client });
  }
}
