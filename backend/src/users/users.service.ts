import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Region, type Role, type User, UserStatus } from '@prisma/client';
import { diffFields, AuditService } from '../core/audit/audit.service';
import { AppException, validationFailed } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { hashPassword, passwordProblems } from '../core/security/password';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { ADMIN_ROLE_ID } from '../auth/permissions';
import { SessionsService } from '../auth/sessions.service';
import { LINK_TTL_MS, type IssuedLink, UserTokensService } from '../auth/user-tokens.service';
import { EmailService, type TemplateVariables } from '../notifications/email.service';
import { assertWithinActor } from '../roles/role-access';
import type { InviteUserDto, ListUsersQuery, UpdateUserDto } from './dto';

/** An invite/reset link plus whether it was emailed (the copy-link path covers the rest). */
export interface EmailedLink extends IssuedLink {
  emailed: boolean;
}

/** "48 hours" from a TTL in milliseconds, for the email templates. */
const friendlyTtl = (ms: number): string => {
  const hours = Math.round(ms / 3_600_000);
  return hours === 1 ? '1 hour' : `${hours} hours`;
};

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: { id: string; name: string };
  status: UserStatus;
  locked: boolean;
  region: { id: string; name: string } | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  version: number;
}

type UserWithRole = User & { region: Region | null; role: Role };
const WITH_ROLE = { region: true, role: true } as const;

export function toUserRow(user: UserWithRole): UserRow {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: { id: user.role.id, name: user.role.name },
    status: user.status,
    locked: !!user.lockedUntil && user.lockedUntil > new Date(),
    region: user.region ? { id: user.region.id, name: user.region.name } : null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    version: user.version,
  };
}

const notFound = () =>
  new AppException('USER_NOT_FOUND', 'That user no longer exists.', HttpStatus.NOT_FOUND);

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
    private readonly links: UserTokensService,
    private readonly email: EmailService,
  ) {}

  /**
   * Emails an invite/reset link when email is on. Never throws and returns
   * whether the email was queued; the admin can always copy the link instead.
   */
  private async emailLink(
    to: string,
    templateKey: 'auth.invite' | 'auth.reset',
    variables: TemplateVariables,
  ): Promise<boolean> {
    const queued = await this.email.queueEmail({ to, templateKey, variables });
    return queued !== null;
  }

  async list(query: ListUsersQuery) {
    const where: Prisma.UserWhereInput = {
      roleId: query.roleId,
      status: query.status,
      regionId: query.regionId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: WITH_ROLE,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      data: users.map(toUserRow),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  private async assertRegion(regionId: string | null | undefined, tx: Prisma.TransactionClient) {
    if (!regionId) return;
    const exists = await tx.region.findUnique({ where: { id: regionId } });
    if (!exists)
      throw validationFailed([{ field: 'regionId', message: 'Choose a region from the list.' }]);
  }

  /** The role being given, checked against what the actor may grant. */
  private async assignableRole(actor: AuthUser, roleId: string, tx: Prisma.TransactionClient) {
    const role = await tx.role.findUnique({ where: { id: roleId } });
    if (!role)
      throw validationFailed([{ field: 'roleId', message: 'Choose a role from the list.' }]);
    assertWithinActor(actor, role, 'assign');
    return role;
  }

  /** Loads a user and checks the actor may manage someone with their role. */
  private async manageable(actor: AuthUser, id: string, tx: Prisma.TransactionClient) {
    const user = await tx.user.findUnique({ where: { id }, include: WITH_ROLE });
    if (!user) throw notFound();
    if (user.id !== actor.id) assertWithinActor(actor, user.role, 'manage');
    return user;
  }

  async invite(
    actor: AuthUser,
    dto: InviteUserDto,
    client: ClientInfo,
  ): Promise<{ user: UserRow; invite: EmailedLink }> {
    const email = dto.email.trim().toLowerCase();
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.assertRegion(dto.regionId, tx);
        await this.assignableRole(actor, dto.roleId, tx);
        const user = await tx.user.create({
          data: {
            email,
            name: dto.name.trim(),
            roleId: dto.roleId,
            regionId: dto.regionId ?? null,
            status: 'INVITED',
          },
          include: WITH_ROLE,
        });
        const invite = await this.links.issue(user.id, 'INVITE', actor.id, tx);
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'user.invited',
            entityType: 'user',
            entityId: user.id,
            summary: `${actor.name} invited ${user.name} (${email}) as ${user.role.name}`,
            ip: client.ip,
            requestId: client.requestId,
          },
          tx,
        );
        return { user: toUserRow(user), invite };
      });
      const emailed = await this.emailLink(email, 'auth.invite', {
        name: result.user.name,
        inviteUrl: result.invite.url,
        expiresIn: friendlyTtl(LINK_TTL_MS.INVITE),
      });
      return { user: result.user, invite: { ...result.invite, emailed } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(
          'EMAIL_TAKEN',
          'Someone with that email already has an account.',
          HttpStatus.CONFLICT,
          [{ field: 'email', message: 'Someone with that email already has an account.' }],
        );
      }
      throw error;
    }
  }

  /** Only active users on the Administrator role other than `excludingId` count. */
  private async otherActiveAdmins(
    excludingId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    return tx.user.count({
      where: { role: { isLocked: true }, status: 'ACTIVE', id: { not: excludingId } },
    });
  }

  private lastAdmin() {
    return new AppException(
      'LAST_ADMIN',
      'At least one active administrator is required. Make someone else an administrator first.',
      HttpStatus.CONFLICT,
    );
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateUserDto,
    client: ClientInfo,
  ): Promise<UserRow> {
    return this.prisma.$transaction(async (tx) => {
      const user = await this.manageable(actor, id, tx);
      if (user.version !== dto.version) {
        throw new AppException(
          'VERSION_CONFLICT',
          'Someone else changed this user while you were editing. Reload to see their changes.',
          HttpStatus.CONFLICT,
        );
      }
      if (dto.roleId && dto.roleId !== user.roleId) {
        if (id === actor.id)
          throw new AppException(
            'OWN_ROLE',
            "You can't change your own role.",
            HttpStatus.CONFLICT,
          );
        if (
          user.role.isLocked &&
          user.status === 'ACTIVE' &&
          (await this.otherActiveAdmins(id, tx)) === 0
        ) {
          throw this.lastAdmin();
        }
        await this.assignableRole(actor, dto.roleId, tx);
      }
      await this.assertRegion(dto.regionId, tx);

      const data = { name: dto.name?.trim(), roleId: dto.roleId, regionId: dto.regionId };
      const changes = diffFields(
        { name: user.name, roleId: user.roleId, regionId: user.regionId },
        data,
      );
      const updated = await tx.user.update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
        include: WITH_ROLE,
      });
      if (Object.keys(changes).length) {
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'user.updated',
            entityType: 'user',
            entityId: id,
            summary: `${actor.name} updated ${updated.name}: ${Object.keys(changes).join(', ')}`,
            changes,
            ip: client.ip,
            requestId: client.requestId,
          },
          tx,
        );
      }
      return toUserRow(updated);
    });
  }

  async setActive(
    actor: AuthUser,
    id: string,
    active: boolean,
    client: ClientInfo,
  ): Promise<UserRow> {
    const row = await this.prisma.$transaction(async (tx) => {
      const user = await this.manageable(actor, id, tx);
      if (!active) {
        if (id === actor.id) {
          throw new AppException(
            'OWN_ACCOUNT',
            "You can't deactivate your own account.",
            HttpStatus.CONFLICT,
          );
        }
        if (
          user.role.isLocked &&
          user.status === 'ACTIVE' &&
          (await this.otherActiveAdmins(id, tx)) === 0
        ) {
          throw this.lastAdmin();
        }
      }
      // Reactivating someone who never set a password puts them back to "invited".
      const status: UserStatus = active
        ? user.passwordHash
          ? 'ACTIVE'
          : 'INVITED'
        : 'DEACTIVATED';
      if (status === user.status) return toUserRow(user);

      const updated = await tx.user.update({
        where: { id },
        data: {
          status,
          version: { increment: 1 },
          ...(active ? { failedLoginCount: 0, lockedUntil: null } : {}),
        },
        include: WITH_ROLE,
      });
      if (!active) {
        await tx.userToken.updateMany({
          where: { userId: id, usedAt: null },
          data: { usedAt: new Date() },
        });
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: active ? 'user.reactivated' : 'user.deactivated',
          entityType: 'user',
          entityId: id,
          summary: `${actor.name} ${active ? 'reactivated' : 'deactivated'} ${user.name}`,
          ip: client.ip,
          requestId: client.requestId,
        },
        tx,
      );
      return toUserRow(updated);
    });
    if (!active) await this.sessions.revokeAllForUser(id, 'deactivated');
    return row;
  }

  /** New invite link for someone who hasn't accepted yet (the old link stops working). */
  async reissueInvite(actor: AuthUser, id: string, client: ClientInfo): Promise<EmailedLink> {
    const link = await this.prisma.$transaction(async (tx) => {
      const user = await this.manageable(actor, id, tx);
      if (user.status !== 'INVITED') {
        throw new AppException(
          'NOT_INVITED',
          'This person has already set up their account.',
          HttpStatus.CONFLICT,
        );
      }
      const link = await this.links.issue(id, 'INVITE', actor.id, tx);
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'user.invite_reissued',
          entityType: 'user',
          entityId: id,
          summary: `${actor.name} created a new invite link for ${user.name}`,
          ip: client.ip,
          requestId: client.requestId,
        },
        tx,
      );
      return { link, name: user.name, email: user.email };
    });
    const emailed = await this.emailLink(link.email, 'auth.invite', {
      name: link.name,
      inviteUrl: link.link.url,
      expiresIn: friendlyTtl(LINK_TTL_MS.INVITE),
    });
    return { ...link.link, emailed };
  }

  /** A reset link the admin hands to the user; emailed too when email is on. */
  async issueResetLink(actor: AuthUser, id: string, client: ClientInfo): Promise<EmailedLink> {
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await this.manageable(actor, id, tx);
      if (user.status !== 'ACTIVE') {
        throw new AppException(
          'NOT_ACTIVE',
          'Only active accounts can get a reset link. Reactivate the account first, or send a new invite.',
          HttpStatus.CONFLICT,
        );
      }
      const link = await this.links.issue(id, 'PASSWORD_RESET', actor.id, tx);
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'user.reset_link_issued',
          entityType: 'user',
          entityId: id,
          summary: `${actor.name} created a password reset link for ${user.name}`,
          ip: client.ip,
          requestId: client.requestId,
        },
        tx,
      );
      return { link, name: user.name, email: user.email };
    });
    const emailed = await this.emailLink(result.email, 'auth.reset', {
      name: result.name,
      resetUrl: result.link.url,
      expiresIn: friendlyTtl(LINK_TTL_MS.PASSWORD_RESET),
    });
    return { ...result.link, emailed };
  }

  /** Used by the admin:create command to bootstrap an install. */
  async createActiveAdmin(input: { email: string; name: string; password: string }): Promise<User> {
    const email = input.email.trim().toLowerCase();
    const problems = passwordProblems(input.password, { email });
    if (problems.length) throw new Error(problems.join(' '));
    const passwordHash = await hashPassword(input.password);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new Error(`A user with email ${email} already exists.`);
      const user = await tx.user.create({
        data: {
          email,
          name: input.name.trim(),
          roleId: ADMIN_ROLE_ID,
          status: 'ACTIVE',
          passwordHash,
          passwordChangedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          actorId: null,
          action: 'user.admin_created',
          entityType: 'user',
          entityId: user.id,
          summary: `Administrator ${user.name} (${email}) was created from the command line`,
        },
        tx,
      );
      return user;
    });
  }
}
