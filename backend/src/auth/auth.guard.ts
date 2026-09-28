import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { AppException } from '../core/http/app.exception';
import type { AccessTokenClaims, AuthUser } from './auth.types';
import { ACCESS_COOKIE } from './cookies';
import {
  type AuthedRequest,
  IS_PUBLIC,
  RECENT_AUTH_MINUTES,
  REQUIRED_PERMISSIONS,
} from './decorators';
import { permissionsOf, type Permission } from './permissions';
import { SessionsService } from './sessions.service';

const unauthenticated = () =>
  new AppException('UNAUTHENTICATED', 'Sign in to continue.', HttpStatus.UNAUTHORIZED);

/** Reads the access token from the auth cookie, or a Bearer header for non-browser clients. */
export function extractAccessToken(request: AuthedRequest): string | undefined {
  const cookies = request.cookies as Record<string, string> | undefined;
  const fromCookie = cookies?.[ACCESS_COOKIE];
  if (fromCookie) return fromCookie;
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

/**
 * Global guard. Every route requires a signed-in, active user unless marked
 * @Public(). Also enforces @RequirePermissions and @RequireRecentAuth.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = extractAccessToken(request);
    if (!token) throw unauthenticated();

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        // The web app refreshes and retries when it sees this code.
        throw new AppException(
          'TOKEN_EXPIRED',
          'Your session needs refreshing.',
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw unauthenticated();
    }

    // One indexed lookup per request (with the role joined), so sign-out,
    // deactivation and permission changes take effect immediately rather
    // than when the token expires.
    const session = await this.sessions.findActive(claims.sid, claims.sub);
    if (!session) {
      throw new AppException(
        'SESSION_ENDED',
        'Your session has ended. Sign in again.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const { user } = session;
    const permissions = permissionsOf(user.role);
    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      isAdmin: user.role.isLocked,
      ticketScope: user.role.ticketScope,
      regionId: user.regionId,
      permissions,
      sessionId: session.id,
      stepUpAt: session.stepUpAt,
    };
    request.user = authUser;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    if (required?.some((permission) => !permissions.includes(permission))) {
      throw new AppException('FORBIDDEN', "You don't have access to this.", HttpStatus.FORBIDDEN);
    }

    const recentMinutes = this.reflector.getAllAndOverride<number | undefined>(
      RECENT_AUTH_MINUTES,
      targets,
    );
    if (recentMinutes !== undefined) {
      const fresh =
        session.stepUpAt && Date.now() - session.stepUpAt.getTime() <= recentMinutes * 60_000;
      if (!fresh) {
        throw new AppException(
          'STEP_UP_REQUIRED',
          'Confirm your password to continue.',
          HttpStatus.FORBIDDEN,
        );
      }
    }
    return true;
  }
}
