import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Role, Session, User } from '@prisma/client';
import { AppConfig } from '../core/config/app-config.service';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { generateToken, hashToken } from '../core/security/tokens';
import type { ClientInfo } from './auth.types';

/** Two tabs may refresh with the same token at once; the loser gets this long to catch up. */
export const ROTATION_GRACE_MS = 60_000;
const DAY_MS = 86_400_000;

export type SessionWithUser = Session & { user: User & { role: Role } };

export interface RotationResult {
  session: SessionWithUser;
  /** New refresh token, or undefined when the browser already holds the current one. */
  refreshToken?: string;
}

export const sessionEnded = () =>
  new AppException(
    'SESSION_ENDED',
    'Your session has ended. Sign in again.',
    HttpStatus.UNAUTHORIZED,
  );

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  get idleMs(): number {
    return this.config.get('SESSION_IDLE_DAYS') * DAY_MS;
  }

  async create(
    userId: string,
    client: ClientInfo,
  ): Promise<{ session: Session; refreshToken: string }> {
    const refreshToken = generateToken();
    const now = Date.now();
    const absolute = new Date(now + this.config.get('SESSION_MAX_DAYS') * DAY_MS);
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Math.min(now + this.idleMs, absolute.getTime())),
        absoluteExpiresAt: absolute,
        ip: client.ip,
        userAgent: client.userAgent,
      },
    });
    return { session, refreshToken };
  }

  /**
   * Exchanges a refresh token for a new one. Presenting the *previous* token
   * after the grace window means it was copied: the whole session is revoked.
   */
  async rotate(presented: string, client: ClientInfo, now = new Date()): Promise<RotationResult> {
    const hash = hashToken(presented);
    const session = await this.prisma.session.findFirst({
      where: { OR: [{ tokenHash: hash }, { previousTokenHash: hash }] },
      include: { user: { include: { role: true } } },
    });
    if (!session) throw sessionEnded();
    this.assertUsable(session, now);

    if (session.tokenHash !== hash) return this.handlePreviousToken(session, now);

    const refreshToken = generateToken();
    const expiresAt = new Date(
      Math.min(now.getTime() + this.idleMs, session.absoluteExpiresAt.getTime()),
    );
    // Conditional on the token we matched, so two concurrent rotations can't both succeed.
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id, tokenHash: hash, revokedAt: null },
      data: {
        tokenHash: hashToken(refreshToken),
        previousTokenHash: hash,
        rotatedAt: now,
        expiresAt,
        lastUsedAt: now,
        ip: client.ip,
        userAgent: client.userAgent,
      },
    });
    if (count === 0) {
      // Another request rotated first; our token is now the previous one.
      const latest = await this.prisma.session.findUnique({
        where: { id: session.id },
        include: { user: { include: { role: true } } },
      });
      if (!latest) throw sessionEnded();
      this.assertUsable(latest, now);
      return this.handlePreviousToken(latest, now);
    }
    return { session: { ...session, expiresAt, lastUsedAt: now }, refreshToken };
  }

  private async handlePreviousToken(session: SessionWithUser, now: Date): Promise<RotationResult> {
    const rotatedAt = session.rotatedAt?.getTime() ?? 0;
    if (now.getTime() - rotatedAt <= ROTATION_GRACE_MS) return { session };
    this.logger.warn(
      { sessionId: session.id, userId: session.userId },
      'Refresh token reuse detected; revoking session',
    );
    await this.revoke(session.id, 'refresh_token_reuse');
    throw sessionEnded();
  }

  private assertUsable(session: Session, now: Date): void {
    if (session.revokedAt || session.expiresAt <= now || session.absoluteExpiresAt <= now)
      throw sessionEnded();
  }

  /** Active session plus its user, for the auth guard. */
  findActive(sessionId: string, userId: string, now = new Date()): Promise<SessionWithUser | null> {
    return this.prisma.session.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
        user: { status: 'ACTIVE' },
      },
      include: { user: { include: { role: true } } },
    });
  }

  async findByRefreshToken(presented: string): Promise<Session | null> {
    const hash = hashToken(presented);
    return this.prisma.session.findFirst({
      where: { OR: [{ tokenHash: hash }, { previousTokenHash: hash }] },
    });
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForUser(
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  async markStepUp(sessionId: string, at = new Date()): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { stepUpAt: at } });
  }
}
