import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Region, User } from '@prisma/client';
import { AuditService } from '../core/audit/audit.service';
import { AppConfig } from '../core/config/app-config.service';
import { AppException, validationFailed } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { RateLimitService } from '../core/rate-limit/rate-limit.service';
import {
  burnPasswordCheck,
  hashPassword,
  passwordProblems,
  verifyPassword,
} from '../core/security/password';
import type { AccessTokenClaims, AuthUser, ClientInfo, MeResponse } from './auth.types';
import { permissionsFor, ROLE_LABELS } from './permissions';
import { SessionsService } from './sessions.service';
import { UserTokensService } from './user-tokens.service';

export const MAX_FAILED_LOGINS = 10;
/** 423 Locked; not in Nest 10's HttpStatus enum. */
const HTTP_LOCKED = 423 as HttpStatus;
export const LOCKOUT_MINUTES = 15;

export interface SignedIn {
  me: MeResponse;
  accessToken: string;
  /** Absent when the browser already holds the current refresh token. */
  refreshToken?: string;
}

const invalidCredentials = () =>
  new AppException(
    'INVALID_CREDENTIALS',
    'Email or password is incorrect.',
    HttpStatus.UNAUTHORIZED,
  );

export function toMe(user: User & { region?: Region | null }): MeResponse {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roleLabel: ROLE_LABELS[user.role],
      status: user.status,
      region: user.region ? { id: user.region.id, name: user.region.name } : null,
    },
    permissions: permissionsFor(user.role),
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly sessions: SessionsService,
    private readonly links: UserTokensService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  async login(emailInput: string, password: string, client: ClientInfo): Promise<SignedIn> {
    const email = emailInput.trim().toLowerCase();
    await this.rateLimit.enforce(`login:ip:${client.ip ?? 'unknown'}`, 30, 15 * 60);
    await this.rateLimit.enforce(`login:email:${email}`, 10, 15 * 60);

    const user = await this.prisma.user.findUnique({ where: { email }, include: { region: true } });
    if (!user?.passwordHash) {
      await burnPasswordCheck(password);
      throw invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppException(
        'ACCOUNT_LOCKED',
        `Too many wrong passwords. Try again after ${LOCKOUT_MINUTES} minutes, or ask an administrator for a reset link.`,
        HTTP_LOCKED,
      );
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      await this.recordFailure(user, client);
      throw invalidCredentials();
    }
    // Only reveal the account state to someone who knows the password.
    if (user.status !== 'ACTIVE') {
      throw new AppException(
        'ACCOUNT_DEACTIVATED',
        'This account has been deactivated. Ask an administrator to reactivate it.',
        HttpStatus.FORBIDDEN,
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      include: { region: true },
    });
    await this.rateLimit.reset(`login:email:${email}`);
    const signedIn = await this.startSession(updated, client);
    await this.audit.record({
      actorId: user.id,
      action: 'auth.signed_in',
      entityType: 'user',
      entityId: user.id,
      summary: `${user.name} signed in`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return signedIn;
  }

  private async recordFailure(user: User, client: ClientInfo): Promise<void> {
    const failures = user.failedLoginCount + 1;
    const locks = failures >= MAX_FAILED_LOGINS;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: locks ? 0 : failures,
        lockedUntil: locks ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : undefined,
      },
    });
    if (locks) {
      await this.audit.record({
        actorId: null,
        action: 'auth.locked',
        entityType: 'user',
        entityId: user.id,
        summary: `${user.name}'s account was locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_LOGINS} wrong passwords`,
        ip: client.ip,
        requestId: client.requestId,
      });
    }
  }

  private async startSession(
    user: User & { region?: Region | null },
    client: ClientInfo,
  ): Promise<SignedIn> {
    const { session, refreshToken } = await this.sessions.create(user.id, client);
    return {
      me: toMe(user),
      accessToken: await this.signAccess(user.id, session.id),
      refreshToken,
    };
  }

  signAccess(userId: string, sessionId: string): Promise<string> {
    const claims: AccessTokenClaims = { sub: userId, sid: sessionId };
    return this.jwt.signAsync(claims);
  }

  async refresh(refreshToken: string, client: ClientInfo): Promise<SignedIn> {
    const { session, refreshToken: next } = await this.sessions.rotate(refreshToken, client);
    if (session.user.status !== 'ACTIVE') {
      await this.sessions.revoke(session.id, 'user_not_active');
      throw new AppException(
        'SESSION_ENDED',
        'Your session has ended. Sign in again.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
      include: { region: true },
    });
    return {
      me: toMe(user),
      accessToken: await this.signAccess(user.id, session.id),
      refreshToken: next,
    };
  }

  async logoutByRefreshToken(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const session = await this.sessions.findByRefreshToken(refreshToken);
    if (session) await this.sessions.revoke(session.id, 'signed_out');
  }

  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { region: true },
    });
    return toMe(user);
  }

  async updateProfile(actor: AuthUser, name: string, client: ClientInfo): Promise<MeResponse> {
    const trimmed = name.trim();
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: actor.id },
        data: { name: trimmed, version: { increment: 1 } },
        include: { region: true },
      });
      if (trimmed !== actor.name) {
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'user.profile_updated',
            entityType: 'user',
            entityId: actor.id,
            summary: `${trimmed} updated their name`,
            changes: { name: { from: actor.name, to: trimmed } },
            ip: client.ip,
            requestId: client.requestId,
          },
          tx,
        );
      }
      return updated;
    });
    return toMe(user);
  }

  /** Re-entering the password unlocks sensitive actions for 10 minutes on this session. */
  async confirmPassword(actor: AuthUser, password: string): Promise<void> {
    await this.rateLimit.enforce(`step-up:${actor.id}`, 5, 15 * 60);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
      throw new AppException(
        'INVALID_CREDENTIALS',
        'That password is incorrect.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.sessions.markStepUp(actor.sessionId);
  }

  async changePassword(
    actor: AuthUser,
    current: string,
    next: string,
    client: ClientInfo,
  ): Promise<void> {
    await this.rateLimit.enforce(`change-password:${actor.id}`, 5, 15 * 60);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) {
      throw validationFailed([
        { field: 'currentPassword', message: 'Your current password is incorrect.' },
      ]);
    }
    const problems = passwordProblems(next, { email: user.email });
    if (current === next) problems.push('Choose a password different from your current one.');
    if (problems.length)
      throw validationFailed(problems.map((message) => ({ field: 'newPassword', message })));

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'auth.password_changed',
          entityType: 'user',
          entityId: user.id,
          summary: `${user.name} changed their password and was signed out on other devices`,
          ip: client.ip,
          requestId: client.requestId,
        },
        tx,
      );
    });
    await this.sessions.revokeAllForUser(user.id, 'password_changed', actor.sessionId);
  }

  async signOutOtherDevices(actor: AuthUser, client: ClientInfo): Promise<number> {
    const count = await this.sessions.revokeAllForUser(
      actor.id,
      'signed_out_elsewhere',
      actor.sessionId,
    );
    await this.audit.record({
      actorId: actor.id,
      action: 'auth.signed_out_elsewhere',
      entityType: 'user',
      entityId: actor.id,
      summary: `${actor.name} signed out on ${count} other device${count === 1 ? '' : 's'}`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return count;
  }

  /** What the welcome / reset page shows before the user sets a password. */
  async describeLink(token: string) {
    const { type, user, expiresAt } = await this.links.peek(token);
    return { type, name: user.name, email: user.email, expiresAt };
  }

  /** Sets the password from an invite or reset link and signs the user in. */
  async acceptLink(token: string, password: string, client: ClientInfo): Promise<SignedIn> {
    const { user: preview } = await this.links.peek(token);
    const problems = passwordProblems(password, { email: preview.email });
    if (problems.length)
      throw validationFailed(problems.map((message) => ({ field: 'password', message })));
    const passwordHash = await hashPassword(password);

    const user = await this.prisma.$transaction(async (tx) => {
      const { type, userId } = await this.links.consume(token, tx);
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          status: 'ACTIVE',
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
        },
        include: { region: true },
      });
      await this.audit.record(
        {
          actorId: userId,
          action: type === 'INVITE' ? 'user.invite_accepted' : 'auth.password_reset',
          entityType: 'user',
          entityId: userId,
          summary:
            type === 'INVITE'
              ? `${updated.name} accepted their invite and set a password`
              : `${updated.name} reset their password with a reset link`,
          ip: client.ip,
          requestId: client.requestId,
        },
        tx,
      );
      if (type === 'PASSWORD_RESET') {
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'password_reset' },
        });
      }
      return updated;
    });
    return this.startSession(user, client);
  }
}
