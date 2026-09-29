import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Client, Public } from '../auth/decorators';
import type { ClientInfo } from '../auth/auth.types';
import { PortalCreateTicketDto, PortalTicketListDto } from './dto';
import { CurrentCustomer, PortalGuard, type CustomerIdentity } from './portal.guard';
import { PortalTicketsService } from './portal-tickets.service';

/**
 * @Public so the global staff AuthGuard skips these routes — customers don't
 * have staff sessions. PortalGuard (below) enforces the portal session, and
 * every query is scoped to the session's customerId with 404-masking.
 */
@Public()
@Controller('portal/tickets')
@UseGuards(PortalGuard)
export class PortalTicketsController {
  constructor(private readonly tickets: PortalTicketsService) {}

  @Get()
  list(@CurrentCustomer() customer: CustomerIdentity, @Query() query: PortalTicketListDto) {
    return this.tickets.list(customer, query.page ?? 1, query.pageSize ?? 20);
  }

  @Post()
  create(
    @CurrentCustomer() customer: CustomerIdentity,
    @Body() dto: PortalCreateTicketDto,
    @Client() client: ClientInfo,
  ) {
    return this.tickets.create(customer, dto, client);
  }

  @Get(':number')
  detail(@CurrentCustomer() customer: CustomerIdentity, @Param('number') number: string) {
    return this.tickets.detail(customer, number);
  }
}
