import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TicketsModule } from '../tickets/tickets.module';
import { PortalAmcController } from './portal-amc.controller';
import { PortalAmcService } from './portal-amc.service';
import { PortalAuthController } from './portal-auth.controller';
import { PortalAuthService } from './portal-auth.service';
import { PortalGuard } from './portal.guard';
import { PortalQuotationsController } from './portal-quotations.controller';
import { PortalQuotationsService } from './portal-quotations.service';
import { PortalStaffController } from './portal-staff.controller';
import { PortalTicketsController } from './portal-tickets.controller';
import { PortalTicketsService } from './portal-tickets.service';

/**
 * Customer portal: magic-link sign-in, the customer's own tickets,
 * quotation approvals/rejections and AMC contract views. Portal auth is a
 * separate cookie scheme from staff sign-in (see PortalGuard); every data
 * route scopes by the session's customerId and 404-masks out-of-scope
 * records.
 */
@Module({
  imports: [TicketsModule, NotificationsModule],
  controllers: [
    PortalAuthController,
    PortalStaffController,
    PortalTicketsController,
    PortalQuotationsController,
    PortalAmcController,
  ],
  providers: [
    PortalGuard,
    PortalAuthService,
    PortalTicketsService,
    PortalQuotationsService,
    PortalAmcService,
  ],
})
export class PortalModule {}
