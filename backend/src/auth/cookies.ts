import type { CookieOptions, Response } from 'express';

export const ACCESS_COOKIE = 'sb_access';
export const REFRESH_COOKIE = 'sb_refresh';
/** Not a credential: tells the web app's proxy that a sign-in exists (optimistic redirect). */
export const SIGNED_IN_COOKIE = 'sb_signed_in';

export interface CookieSettings {
  secure: boolean;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

/**
 * - Access token: sent to every API call (path /api), 15 minutes.
 * - Refresh token: sent only to the auth endpoints, so it rarely leaves the browser.
 * - All httpOnly (no script can read them) and SameSite=Strict (no cross-site use),
 *   except the non-secret sign-in marker, which is Lax so links from email still
 *   land on the app instead of the login page.
 */
export function setAuthCookies(
  res: Response,
  tokens: { access: string; refresh?: string },
  s: CookieSettings,
) {
  const base: CookieOptions = { httpOnly: true, secure: s.secure, sameSite: 'strict' };
  res.cookie(ACCESS_COOKIE, tokens.access, {
    ...base,
    path: '/api',
    maxAge: s.accessTtlSeconds * 1000,
  });
  if (tokens.refresh) {
    res.cookie(REFRESH_COOKIE, tokens.refresh, {
      ...base,
      path: '/api/v1/auth',
      maxAge: s.refreshTtlSeconds * 1000,
    });
    res.cookie(SIGNED_IN_COOKIE, '1', {
      ...base,
      sameSite: 'lax',
      path: '/',
      maxAge: s.refreshTtlSeconds * 1000,
    });
  }
}

export function clearAuthCookies(res: Response, secure: boolean) {
  const base: CookieOptions = { httpOnly: true, secure, sameSite: 'strict' };
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/api' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: '/api/v1/auth' });
  res.clearCookie(SIGNED_IN_COOKIE, { ...base, sameSite: 'lax', path: '/' });
}
