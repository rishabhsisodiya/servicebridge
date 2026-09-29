import { Controller, Param, Post } from '@nestjs/common';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { Client, CurrentUser, RequirePermissions, RequireRecentAuth } from '../auth/decorators';
import { PortalAuthService } from './portal-auth.service';

/**
 * Staff side of the portal: issuing sign-in links for customer contacts when
 * email isn't configured (or the contact has no usable email). The staff
 * member copies the link and shares it with the customer manually.
 *
 * A sign-in link lets whoever holds it act as the customer, so this carries
 * the same bar as a staff password-reset link: customers.read plus a fresh
 * password check. Every issuance is audited with the staff member's identity.
 */
@Controller('portal/staff')
@RequirePermissions('customers.read')
export class PortalStaffController {
  constructor(private readonly auth: PortalAuthService) {}

  @Post('contacts/:contactId/sign-in-link')
  @RequireRecentAuth()
  issueSignInLink(
    @CurrentUser() actor: AuthUser,
    @Param('contactId') contactId: string,
    @Client() client: ClientInfo,
  ): Promise<{ link: string; expiresAt: string }> {
    return this.auth.issueStaffLink(actor, contactId, client);
  }
}
