import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import {
  AddLineDto,
  CreateQuotationDto,
  ListQuotationsDto,
  RecordPoDto,
  UpdateLineDto,
  UpdateQuotationDto,
  VersionDto,
} from './dto';
import { QuotationsService } from './quotations.service';

@Controller('quotations')
@RequirePermissions('quotations.read')
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Post()
  @RequirePermissions('quotations.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateQuotationDto) {
    return this.quotations.create(user, dto);
  }

  /** Every quotation the viewer may see, newest first, paginated. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListQuotationsDto) {
    return this.quotations.list(user, query);
  }

  /** Quotations on one ticket, newest first. Declared before ':id'. */
  @Get('ticket/:ticketId')
  listForTicket(@CurrentUser() user: AuthUser, @Param('ticketId') ticketId: string) {
    return this.quotations.listForTicket(user, ticketId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotations.get(user, id);
  }

  /** The printable view: company, customer, lines and computed totals. */
  @Get(':id/print')
  print(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotations.print(user, id);
  }

  @Patch(':id')
  @RequirePermissions('quotations.edit')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.quotations.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('quotations.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.quotations.remove(user, id);
  }

  @Post(':id/send')
  @RequirePermissions('quotations.edit')
  send(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotations.send(user, id);
  }

  @Post(':id/po')
  @RequirePermissions('quotations.edit')
  recordPo(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RecordPoDto) {
    return this.quotations.recordPo(user, id, dto);
  }

  @Post(':id/revise')
  @RequirePermissions('quotations.create')
  revise(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VersionDto) {
    return this.quotations.revise(user, id, dto.version);
  }

  @Post(':id/cancel')
  @RequirePermissions('quotations.edit')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VersionDto) {
    return this.quotations.cancel(user, id, dto.version);
  }

  @Post(':id/lines')
  @RequirePermissions('quotations.edit')
  addLine(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddLineDto) {
    return this.quotations.addLine(user, id, dto);
  }

  @Patch(':id/lines/:lineId')
  @RequirePermissions('quotations.edit')
  updateLine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateLineDto,
  ) {
    return this.quotations.updateLine(user, id, lineId, dto);
  }

  @Delete(':id/lines/:lineId')
  @RequirePermissions('quotations.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeLine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ) {
    await this.quotations.removeLine(user, id, lineId);
  }
}
