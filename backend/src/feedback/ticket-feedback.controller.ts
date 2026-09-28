import { Controller, Get, Param } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { CsatService } from './csat.service';

/** The service team reads a ticket's feedback on the ticket page. */
@Controller('tickets/:ticketId/feedback')
export class TicketFeedbackController {
  constructor(private readonly csat: CsatService) {}

  @Get()
  @RequirePermissions('tickets.read')
  list(@CurrentUser() actor: AuthUser, @Param('ticketId') ticketId: string) {
    return this.csat.forTicket(ticketId, actor);
  }
}
