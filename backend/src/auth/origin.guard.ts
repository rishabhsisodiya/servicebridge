import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '../core/config/app-config.service';
import { AppException } from '../core/http/app.exception';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defence in depth against cross-site request forgery. The auth cookies are
 * already SameSite=Strict; this also rejects any state-changing request whose
 * Origin header names a site we don't serve. Requests without an Origin
 * (server-to-server, partner API with its own key) are unaffected.
 * Runs before AuthGuard (registered first).
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(config: AppConfig) {
    this.allowed = new Set(
      [config.get('APP_URL'), ...config.get('CORS_ORIGINS')].map(
        (origin) => new URL(origin).origin,
      ),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;
    if (SAFE_METHODS.has(request.method) || !origin || this.allowed.has(origin)) return true;
    throw new AppException(
      'ORIGIN_NOT_ALLOWED',
      'This request came from a site that is not allowed.',
      HttpStatus.FORBIDDEN,
    );
  }
}
