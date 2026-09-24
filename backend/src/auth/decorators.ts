import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser, ClientInfo } from './auth.types';
import type { Permission } from './permissions';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_PERMISSIONS = 'auth:permissions';
export const RECENT_AUTH_MINUTES = 'auth:recent';

/** Route needs no sign-in (login, invite acceptance, health checks). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Caller's role must grant every listed permission. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Caller must have re-entered their password within the last `minutes`. */
export const RequireRecentAuth = (minutes = 10) => SetMetadata(RECENT_AUTH_MINUTES, minutes);

export type AuthedRequest = Request & { user?: AuthUser; id?: string };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw new Error('CurrentUser used on a route without authentication');
    return user;
  },
);

export function clientInfoOf(request: AuthedRequest): ClientInfo {
  return {
    // `trust proxy` is set in bootstrap, so req.ip is the browser's address.
    ip: request.ip ?? null,
    userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
    requestId: request.id ?? null,
  };
}

export const Client = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClientInfo =>
  clientInfoOf(ctx.switchToHttp().getRequest<AuthedRequest>()),
);
