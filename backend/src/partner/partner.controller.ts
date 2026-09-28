import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { Client, Public } from '../auth/decorators';
import type { ClientInfo } from '../auth/auth.types';
import { CurrentPartner, PartnerGuard, RequirePartnerScope } from './partner.guard';
import type { PartnerIdentity } from './partner.guard';
import { PartnerService } from './partner.service';
import { PartnerCreateTicketDto } from './dto';

/**
 * Third-party API for partners who log tickets. Authenticated with
 * `Authorization: Bearer sbp_…` (PartnerGuard), not user sessions.
 * Partners see tickets only — no commercial data leaves this controller.
 */
@Public()
@UseGuards(PartnerGuard)
@Controller('partner/v1')
export class PartnerController {
  constructor(private readonly partner: PartnerService) {}

  @Post('tickets')
  @HttpCode(HttpStatus.CREATED)
  @RequirePartnerScope('tickets.create')
  createTicket(
    @CurrentPartner() identity: PartnerIdentity,
    @Body() body: PartnerCreateTicketDto,
    @Client() client: ClientInfo,
  ) {
    return this.partner.createTicket(identity, body, client);
  }

  @Get('tickets/:number')
  @RequirePartnerScope('tickets.read')
  ticketStatus(@CurrentPartner() identity: PartnerIdentity, @Param('number') number: string) {
    return this.partner.ticketStatus(identity, number);
  }
}
