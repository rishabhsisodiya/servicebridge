import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { CurrentCustomer, PortalGuard, type CustomerIdentity } from './portal.guard';
import { PortalAmcService } from './portal-amc.service';

/**
 * @Public so the global staff AuthGuard skips these routes — customers don't
 * have staff sessions. PortalGuard (below) enforces the portal session, and
 * every query is scoped to the session's customerId with 404-masking.
 */
@Public()
@Controller('portal/amc')
@UseGuards(PortalGuard)
export class PortalAmcController {
  constructor(private readonly amc: PortalAmcService) {}

  @Get()
  list(@CurrentCustomer() customer: CustomerIdentity) {
    return this.amc.list(customer);
  }

  @Get(':id')
  detail(@CurrentCustomer() customer: CustomerIdentity, @Param('id') id: string) {
    return this.amc.detail(customer, id);
  }
}
