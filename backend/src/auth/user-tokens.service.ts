import { HttpStatus, Injectable } from '@nestjs/common';
import { type Prisma, type User, UserTokenType } from '@prisma/client';
import { AppConfig } from '../core/config/app-config.service';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { generateToken, hashToken } from '../core/security/tokens';

const HOUR_MS = 3_600_000;

/** Invite links last 48 hours; reset links 2 hours (a reset link grants account access). */
export const LINK_TTL_MS: Record<UserTokenType, number> = {
  INVITE: 48 * HOUR_MS,
  PASSWORD_RESET: 2 * HOUR_MS,
};

const LINK_PATH: Record<UserTokenType, string> = {
  INVITE: '/welcome',
  PASSWORD_RESET: '/reset-password',
};

export interface IssuedLink {
  url: string;
  expiresAt: Date;
}

const linkInvalid = () =>
  new AppException(
    'LINK_INVALID',
    'This link is invalid or has already been used. Ask an administrator for a new one.',
    HttpStatus.GONE,
  );

@Injectable()
export class UserTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Issues a new link and invalidates any unused link of the same type for the user. */
  async issue(
    userId: string,
    type: UserTokenType,
    createdById: string | null,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<IssuedLink> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + LINK_TTL_MS[type]);
    await tx.userToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.userToken.create({
      data: { userId, type, tokenHash: hashToken(token), expiresAt, createdById },
    });
    return { url: `${this.config.get('APP_URL')}${LINK_PATH[type]}/${token}`, expiresAt };
  }

  /** Looks up an unused, unexpired link without consuming it. */
  async peek(token: string): Promise<{ type: UserTokenType; user: User; expiresAt: Date }> {
    const row = await this.prisma.userToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!row || row.usedAt || row.expiresAt <= new Date() || row.user.status === 'DEACTIVATED') {
      throw linkInvalid();
    }
    return { type: row.type, user: row.user, expiresAt: row.expiresAt };
  }

  /** Marks the link used inside `tx`; fails if another request used it first. */
  async consume(
    token: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ type: UserTokenType; userId: string }> {
    const row = await tx.userToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row) throw linkInvalid();
    const { count } = await tx.userToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw linkInvalid();
    return { type: row.type, userId: row.userId };
  }
}
