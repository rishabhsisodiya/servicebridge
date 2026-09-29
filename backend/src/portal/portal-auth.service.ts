import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { CustomerTokenType } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import type { ClientInfo } from '../auth/auth.types';
import { AuditService } from '../core/audit/audit.service';
import { AppConfig } from '../core/config/app-config.service';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { RateLimitService } from '../core/rate-limit/rate-limit.service';
import { generateToken, hashToken } from '../core/security/tokens';
import { EmailService } from '../notifications/email.service';
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  type CustomerIdentity,
  unauthorized,
} from './portal.guard';
import { portalNotFound } from './customer-visibility';

/** Magic links live 15 minutes: long enough to click through email, too short to matter if leaked. */
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

const linkInvalid = () =>
  new AppException(
    'PORTAL_LINK_INVALID',
    'This sign-in link is invalid or has expired. Request a new one.',
    HttpStatus.GONE,
  );

/**
 * Magic-link sign-in for customer contacts. Mirrors user-tokens.service.ts:
 * 256-bit tokens, sha256 at rest, single-use, issuing invalidates prior
 * unused links. The response never reveals whether an email is known.
 */
@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger(PortalAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly email: EmailService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  /** Always { ok: true } — an unknown or inactive email gets the same response. */
  async requestLink(email: string, client: ClientInfo): Promise<{ ok: true }> {
    const normalized = email.trim().toLowerCase();
    await this.rateLimit.enforce(`portal:link:ip:${client.ip ?? 'unknown'}`, 20, 3600);
    await this.rateLimit.enforce(`portal:link:email:${hashToken(normalized)}`, 5, 3600);

    const contact = await this.prisma.customerContact.findFirst({
      where: {
        email: { equals: normalized, mode: 'insensitive' },
        active: true,
        customerId: { not: null },
        customer: { active: true },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        customerId: true,
        customer: { select: { name: true } },
      },
    });
    if (!contact?.customerId || !contact.email) return { ok: true };

    const { link: magicLink } = await this.mintMagicLink(contact.id);
    const queued = await this.email.queueEmail({
      to: contact.email,
      templateKey: 'portal.magic_link',
      variables: { name: contact.fullName, magicLink },
    });
    if (!queued) {
      // queueEmail returns null when email isn't configured or the template is
      // missing/disabled — the response stays 200 so the address isn't leaked.
      this.logger.warn(`Portal magic link for ${contact.id} could not be queued`);
    }
    return { ok: true };
  }

  /**
   * Staff-issued sign-in link, for when email isn't configured (or the
   * contact has no usable email): the staff member copies the link and shares
   * it with the customer manually. The link is single-use and lives 15
   * minutes, exactly like the emailed one; every issuance is audited with the
   * staff member's identity.
   */
  async issueStaffLink(
    actor: AuthUser,
    contactId: string,
    client: ClientInfo,
  ): Promise<{ link: string; expiresAt: string }> {
    const contact = await this.prisma.customerContact.findFirst({
      where: {
        id: contactId,
        active: true,
        customerId: { not: null },
        customer: { active: true },
      },
      select: {
        id: true,
        fullName: true,
        customerId: true,
        customer: { select: { name: true } },
      },
    });
    if (!contact?.customerId) {
      throw portalNotFound(
        'CONTACT_NOT_FOUND',
        "That contact doesn't exist, or isn't linked to an active customer.",
      );
    }
    const { link, expiresAt } = await this.mintMagicLink(contact.id);
    await this.audit.record({
      actorId: actor.id,
      action: 'portal.sign_in_link_issued',
      entityType: 'CustomerContact',
      entityId: contact.id,
      summary: `Portal sign-in link issued for ${contact.fullName} (${contact.customer?.name ?? 'unknown customer'}) by ${actor.name} to share manually.`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return { link, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Mints a single-use magic link for a contact, invalidating prior unused
   * links. Shared by the emailed flow and staff-issued links.
   */
  private async mintMagicLink(contactId: string): Promise<{ link: string; expiresAt: Date }> {
    const raw = generateToken();
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.customerToken.updateMany({
        where: { contactId, type: CustomerTokenType.MAGIC_LINK, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.customerToken.create({
        data: {
          contactId,
          type: CustomerTokenType.MAGIC_LINK,
          tokenHash: hashToken(raw),
          expiresAt,
        },
      });
    });
    const baseUrl = this.config.get('APP_URL');
    return { link: `${baseUrl}/portal/auth/verify?token=${raw}`, expiresAt };
  }

  /** Consumes a magic link and opens a portal session. Returns the raw session token. */
  async verify(raw: string, client: ClientInfo): Promise<{ ok: true; token: string }> {
    const now = new Date();
    const row = await this.prisma.customerToken.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: {
        contact: { include: { customer: { select: { id: true, active: true } } } },
      },
    });
    const contact = row?.contact;
    const customerId = contact?.customerId ?? contact?.customer?.id;
    if (
      !row ||
      row.usedAt ||
      row.expiresAt <= now ||
      !contact ||
      !contact.active ||
      !customerId ||
      contact.customer?.active === false
    ) {
      throw linkInvalid();
    }
    // Single-use, guarded at the database level so a double-click can't mint two sessions.
    const { count } = await this.prisma.customerToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count === 0) throw linkInvalid();

    const token = generateToken();
    await this.prisma.customerSession.create({
      data: {
        contactId: contact.id,
        customerId,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
        absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
        ip: client.ip,
        userAgent: client.userAgent,
      },
    });
    return { ok: true, token };
  }

  /**
   * Validates a session token and returns the customer identity, pushing the
   * sliding expiry forward (capped at the absolute limit). Returns null when
   * the session is unknown, revoked, expired, or the contact/customer went
   * inactive.
   */
  async validateSession(raw: string): Promise<CustomerIdentity | null> {
    const now = new Date();
    const session = await this.prisma.customerSession.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: {
        contact: { select: { id: true, fullName: true, email: true, active: true } },
        customer: { select: { id: true, active: true } },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.absoluteExpiresAt <= now ||
      !session.contact.active ||
      !session.customer.active
    ) {
      return null;
    }
    // Sliding expiry: extend the idle window, never past the absolute limit.
    const nextExpires = new Date(
      Math.min(now.getTime() + SESSION_IDLE_MS, session.absoluteExpiresAt.getTime()),
    );
    if (nextExpires.getTime() !== session.expiresAt.getTime()) {
      await this.prisma.customerSession.update({
        where: { id: session.id },
        data: { expiresAt: nextExpires, lastUsedAt: now },
      });
    }
    return {
      contactId: session.contact.id,
      customerId: session.customer.id,
      contactName: session.contact.fullName,
      email: session.contact.email ?? '',
    };
  }

  /** Rotates the session token (single-use rotation: concurrent refreshes race safely). */
  async refresh(refreshToken: string): Promise<{ ok: true; token: string }> {
    const now = new Date();
    const session = await this.prisma.customerSession.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: {
        contact: { select: { active: true } },
        customer: { select: { active: true } },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.absoluteExpiresAt <= now ||
      !session.contact.active ||
      !session.customer.active
    ) {
      throw unauthorized();
    }
    const token = generateToken();
    const { count } = await this.prisma.customerSession.updateMany({
      where: {
        id: session.id,
        tokenHash: hashToken(refreshToken),
        revokedAt: null,
        expiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      data: {
        tokenHash: hashToken(token),
        expiresAt: new Date(
          Math.min(now.getTime() + SESSION_IDLE_MS, session.absoluteExpiresAt.getTime()),
        ),
        lastUsedAt: now,
      },
    });
    if (count === 0) throw unauthorized();
    return { ok: true, token };
  }

  /** Revokes the session behind the presented token. Always succeeds quietly. */
  async logout(raw: string): Promise<{ ok: true }> {
    await this.prisma.customerSession.updateMany({
      where: { tokenHash: hashToken(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  /** Fresh contact + customer facts for the signed-in portal user. */
  async me(identity: CustomerIdentity) {
    const contact = await this.prisma.customerContact.findUnique({
      where: { id: identity.contactId },
      select: {
        id: true,
        fullName: true,
        email: true,
        active: true,
        customer: { select: { id: true, name: true, active: true } },
      },
    });
    if (!contact?.active || !contact.customer?.active) throw unauthorized();
    return {
      contact: { id: contact.id, fullName: contact.fullName, email: contact.email },
      customer: { id: contact.customer.id, name: contact.customer.name },
    };
  }
}
