import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { RateLimitService } from '../core/rate-limit/rate-limit.service';
import { hashToken } from '../core/security/tokens';
import type { AuthedRequest } from '../auth/decorators';
import { KEY_PREFIX } from './partner-key.service';

export const PARTNER_SCOPES = 'partner:scopes';

/** The partner route requires every listed permission on the API key. */
export const RequirePartnerScope = (...scopes: string[]) => SetMetadata(PARTNER_SCOPES, scopes);

export interface PartnerIdentity {
  keyId: string;
  name: string;
  permissions: string[];
}

export const CurrentPartner = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PartnerIdentity => {
    const partner = (ctx.switchToHttp().getRequest() as { partner?: PartnerIdentity }).partner;
    if (!partner) throw new Error('CurrentPartner used on a route without PartnerGuard');
    return partner;
  },
);

const unauthorized = () =>
  new AppException(
    'UNAUTHENTICATED',
    'Valid partner credentials are required.',
    HttpStatus.UNAUTHORIZED,
  );

/**
 * Key auth for the partner API. Kept deliberately separate from the JWT
 * AuthGuard: partner keys authenticate with `Authorization: Bearer sbp_…`,
 * carry a subset of permissions as scopes, and never create a user session.
 * Partner routes are @Public() so the global AuthGuard skips them; this
 * guard then enforces key auth and per-key scopes.
 */
@Injectable()
export class PartnerGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest & { partner?: PartnerIdentity }>();

    // Light per-IP limit before any key lookup, so bad keys can't hammer the DB.
    await this.rateLimit.enforce(`partner:ip:${request.ip ?? 'unknown'}`, 600, 60);

    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token || !token.startsWith(KEY_PREFIX)) throw unauthorized();

    const key = await this.prisma.partnerApiKey.findUnique({
      where: { keyHash: hashToken(token) },
    });
    const now = new Date();
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= now)) throw unauthorized();

    await this.rateLimit.enforce(`partner:key:${key.id}`, 300, 60);

    const required = this.reflector.getAllAndOverride<string[] | undefined>(PARTNER_SCOPES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.some((scope) => !key.scopes.includes(scope))) {
      throw new AppException(
        'FORBIDDEN',
        "This API key doesn't have access to this.",
        HttpStatus.FORBIDDEN,
      );
    }

    request.partner = { keyId: key.id, name: key.name, permissions: key.scopes };
    // Best effort: a slow update must never fail the partner's request.
    this.prisma.partnerApiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: now } })
      .catch(() => undefined);
    return true;
  }
}
