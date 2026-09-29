import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { AppConfig } from '../core/config/app-config.service';
import { AppException } from '../core/http/app.exception';
import { RateLimitService } from '../core/rate-limit/rate-limit.service';
import { PortalAuthService } from './portal-auth.service';

/** httpOnly: the browser sends it on every API call (path /api), scripts can't read it. */
export const PORTAL_ACCESS_COOKIE = 'sb_portal_access';
/** httpOnly: sent only to the portal auth endpoints (refresh), so it rarely leaves the browser. */
export const PORTAL_REFRESH_COOKIE = 'sb_portal_refresh';
/** Not a credential: tells the web app a portal sign-in exists (optimistic redirect). */
export const PORTAL_SIGNED_IN_COOKIE = 'sb_portal_signed_in';

export const PORTAL_ACCESS_PATH = '/api';
export const PORTAL_REFRESH_PATH = '/api/v1/portal/auth';

/** Sliding expiry: pushed forward on activity, up to SESSION_ABSOLUTE_MS after sign-in. */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CustomerIdentity {
  contactId: string;
  customerId: string;
  contactName: string;
  email: string;
}

interface PortalHttpRequest {
  ip?: string;
  cookies?: Record<string, string | undefined>;
  customer?: CustomerIdentity;
}

export const CurrentCustomer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CustomerIdentity => {
    const customer = ctx.switchToHttp().getRequest<PortalHttpRequest>().customer;
    if (!customer) throw new Error('CurrentCustomer used on a route without PortalGuard');
    return customer;
  },
);

export const unauthorized = () =>
  new AppException(
    'PORTAL_UNAUTHENTICATED',
    'Sign in to the customer portal to continue.',
    HttpStatus.UNAUTHORIZED,
  );

/** Cookies are Secure only when the web app is served over https (mirrors auth cookies). */
export function secureCookies(config: AppConfig): boolean {
  return config.get('APP_URL').startsWith('https://');
}

export function setPortalCookies(res: Response, token: string, secure: boolean) {
  const base: CookieOptions = { httpOnly: true, secure, sameSite: 'strict' };
  res.cookie(PORTAL_ACCESS_COOKIE, token, {
    ...base,
    path: PORTAL_ACCESS_PATH,
    maxAge: SESSION_IDLE_MS,
  });
  res.cookie(PORTAL_REFRESH_COOKIE, token, {
    ...base,
    path: PORTAL_REFRESH_PATH,
    maxAge: SESSION_ABSOLUTE_MS,
  });
  res.cookie(PORTAL_SIGNED_IN_COOKIE, '1', {
    ...base,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_ABSOLUTE_MS,
  });
}

export function clearPortalCookies(res: Response, secure: boolean) {
  const base: CookieOptions = { httpOnly: true, secure, sameSite: 'strict' };
  res.clearCookie(PORTAL_ACCESS_COOKIE, { ...base, path: PORTAL_ACCESS_PATH });
  res.clearCookie(PORTAL_REFRESH_COOKIE, { ...base, path: PORTAL_REFRESH_PATH });
  res.clearCookie(PORTAL_SIGNED_IN_COOKIE, { ...base, sameSite: 'lax', path: '/' });
}

/**
 * Cookie auth for the customer portal. Kept deliberately separate from the
 * staff AuthGuard: portal sessions belong to CustomerContacts, carry only a
 * customerId scope, and never grant staff permissions. Portal routes are
 * @Public() so the global AuthGuard skips them; this guard then enforces
 * portal session auth.
 */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PortalHttpRequest>();

    // Light per-IP limit before any session lookup, so bad cookies can't hammer the DB.
    await this.rateLimit.enforce(`portal:ip:${request.ip ?? 'unknown'}`, 600, 60);

    const token = request.cookies?.[PORTAL_ACCESS_COOKIE];
    if (!token) throw unauthorized();

    const identity = await this.auth.validateSession(token);
    if (!identity) throw unauthorized();

    request.customer = identity;
    return true;
  }
}
