import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Client, Public } from '../auth/decorators';
import type { ClientInfo } from '../auth/auth.types';
import { PortalApproveQuotationDto, PortalQuotationListDto, PortalRejectQuotationDto } from './dto';
import { CurrentCustomer, PortalGuard, type CustomerIdentity } from './portal.guard';
import { PortalQuotationsService } from './portal-quotations.service';

/**
 * @Public so the global staff AuthGuard skips these routes — customers don't
 * have staff sessions. PortalGuard (below) enforces the portal session, and
 * every query is scoped to the session's customerId with 404-masking.
 */
@Public()
@Controller('portal/quotations')
@UseGuards(PortalGuard)
export class PortalQuotationsController {
  constructor(private readonly quotations: PortalQuotationsService) {}

  @Get()
  list(@CurrentCustomer() customer: CustomerIdentity, @Query() query: PortalQuotationListDto) {
    return this.quotations.list(customer, query.ticketNumber?.trim() || undefined);
  }

  @Post(':id/approve')
  approve(
    @CurrentCustomer() customer: CustomerIdentity,
    @Param('id') id: string,
    @Body() dto: PortalApproveQuotationDto,
    @Client() client: ClientInfo,
  ) {
    return this.quotations.approve(customer, id, dto, client);
  }

  @Post(':id/reject')
  reject(
    @CurrentCustomer() customer: CustomerIdentity,
    @Param('id') id: string,
    @Body() dto: PortalRejectQuotationDto,
    @Client() client: ClientInfo,
  ) {
    return this.quotations.reject(customer, id, dto, client);
  }
}
