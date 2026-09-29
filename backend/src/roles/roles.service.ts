import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Role, type TicketScope } from '@prisma/client';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import {
  ACTION_TYPES,
  normalizePermissions,
  type Permission,
  permissionsOf,
  RECORD_TYPES,
} from '../auth/permissions';
import { AuditService, diffFields } from '../core/audit/audit.service';
import { AppException, validationFailed } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { WORKLOAD_STAGES } from '../tickets/engineers.service';
import type { CreateRoleDto, UpdateRoleDto } from './dto';
import { beyondActor, escalation, scopeBeyondActor } from './role-access';

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isLocked: boolean;
  isBuiltIn: boolean;
  ticketScope: TicketScope;
  permissions: Permission[];
  userCount: number;
  version: number;
  updatedAt: Date;
}

export const TICKET_SCOPES: { value: TicketScope; label: string; hint: string }[] = [
  { value: 'ALL', label: 'All tickets', hint: 'Every ticket in every region.' },
  {
    value: 'REGION',
    label: 'Their region',
    hint: 'Tickets in their region, plus any they manage, raised or work on.',
  },
  { value: 'OWN', label: 'Their own', hint: 'Tickets assigned to them or raised by them.' },
];

function toRow(role: Role & { _count: { users: number } }): RoleRow {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isLocked: role.isLocked,
    isBuiltIn: role.key !== null,
    ticketScope: role.ticketScope,
    permissions: permissionsOf(role),
    userCount: role._count.users,
    version: role.version,
    updatedAt: role.updatedAt,
  };
}

const COUNT_USERS = { _count: { select: { users: true } } } as const;

const notFound = () =>
  new AppException('ROLE_NOT_FOUND', 'That role no longer exists.', HttpStatus.NOT_FOUND);

const nameTaken = () =>
  new AppException('ROLE_NAME_TAKEN', 'Another role already has that name.', HttpStatus.CONFLICT, [
    { field: 'name', message: 'Another role already has that name.' },
  ]);

/**
 * Roles admins create and edit. Every change needs a recent password check
 * (enforced on the routes), is audited, and applies on each user's next
 * request because the session lookup joins the role.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<RoleRow[]> {
    const roles = await this.prisma.role.findMany({
      include: COUNT_USERS,
      orderBy: [{ isLocked: 'desc' }, { name: 'asc' }],
    });
    return roles.map(toRow);
  }

  /** Names only, as select options for the user invite and edit forms. */
  async options(): Promise<{ value: string; label: string }[]> {
    const roles = await this.prisma.role.findMany({
      select: { id: true, name: true },
      orderBy: [{ isLocked: 'desc' }, { name: 'asc' }],
    });
    return roles.map((r) => ({ value: r.id, label: r.name }));
  }

  /** What the permission grid shows. Planned permissions are left out until their screens exist. */
  catalog() {
    return { records: RECORD_TYPES, actions: ACTION_TYPES, scopes: TICKET_SCOPES };
  }

  async get(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        ...COUNT_USERS,
        users: { select: { id: true, name: true, status: true }, orderBy: { name: 'asc' } },
      },
    });
    if (!role) throw notFound();
    return { ...toRow(role), users: role.users };
  }

  async create(actor: AuthUser, dto: CreateRoleDto, client: ClientInfo): Promise<RoleRow> {
    return this.prisma.$transaction(async (tx) => {
      const source = dto.copyFromId
        ? await tx.role.findUnique({ where: { id: dto.copyFromId } })
        : null;
      if (dto.copyFromId && !source) {
        throw validationFailed([{ field: 'copyFromId', message: 'Choose a role from the list.' }]);
      }
      const permissions = normalizePermissions(
        dto.permissions ?? (source ? permissionsOf(source) : []),
      );
      const ticketScope = dto.ticketScope ?? source?.ticketScope;
      if (!ticketScope) {
        throw validationFailed([
          { field: 'ticketScope', message: 'Choose which tickets people with this role can see.' },
        ]);
      }
      this.assertGrantable(actor, permissions, ticketScope);
      const name = dto.name.trim();
      await this.assertNameFree(name, null, tx);

      const role = await this.save(() =>
        tx.role.create({
          data: {
            name,
            description: dto.description?.trim() || null,
            permissions,
            ticketScope,
          },
          include: COUNT_USERS,
        }),
      );
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'role.created',
          entityType: 'role',
          entityId: role.id,
          summary: `${actor.name} created the role ${role.name}${source ? ` (copied from ${source.name})` : ''}`,
          changes: {
            permissions: { from: [], to: permissions },
            ticketScope: { from: null, to: ticketScope },
          },
          ip: client.ip,
          requestId: client.requestId,
        },
        tx,
      );
      return toRow(role);
    });
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateRoleDto,
    client: ClientInfo,
  ): Promise<RoleRow & { openTicketsLeftAssigned: number }> {
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { id } });
      if (!role) throw notFound();
      if (role.isLocked) {
        throw new AppException(
          'ROLE_LOCKED',
          'The Administrator role always has every permission and can’t be changed.',
          HttpStatus.CONFLICT,
        );
      }
      if (role.version !== dto.version) {
        throw new AppException(
          'VERSION_CONFLICT',
          'Someone else changed this role while you were editing. Reload to see their changes.',
          HttpStatus.CONFLICT,
        );
      }

      const before = permissionsOf(role);
      const permissions = dto.permissions ? normalizePermissions(dto.permissions) : before;
      const added = permissions.filter((p) => !before.includes(p));
      const removed = before.filter((p) => !permissions.includes(p));
      // The actor must be able to grant the role's COMPLETE post-update access.
      // Checking only added permissions (and only scope widening) let a
      // narrower-scoped role admin widen third parties' access through a wider
      // role: e.g. adding a permission they hold to an ALL-scope role they
      // could never grant directly.
      const finalScope = dto.ticketScope ?? role.ticketScope;
      this.assertGrantable(actor, permissions, finalScope);

      const name = dto.name?.trim();
      if (name && name !== role.name) await this.assertNameFree(name, id, tx);
      const description =
        dto.description === undefined ? undefined : dto.description?.trim() || null;

      const fields = diffFields(
        { name: role.name, description: role.description, ticketScope: role.ticketScope },
        { name, description, ticketScope: dto.ticketScope },
      );
      const changes = {
        ...fields,
        ...(added.length || removed.length ? { permissions: { from: removed, to: added } } : {}),
      };

      const updated = await this.save(() =>
        tx.role.update({
          where: { id },
          data: {
            name,
            description,
            ticketScope: dto.ticketScope,
            permissions,
            version: { increment: 1 },
          },
          include: COUNT_USERS,
        }),
      );
      if (Object.keys(changes).length) {
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'role.updated',
            entityType: 'role',
            entityId: id,
            summary: `${actor.name} updated the role ${updated.name}: ${Object.keys(changes).join(', ')}`,
            changes,
            ip: client.ip,
            requestId: client.requestId,
          },
          tx,
        );
      }

      // People who stop being engineers keep their open tickets until a
      // manager reassigns them; the editor is told how many.
      const openTicketsLeftAssigned = removed.includes('tickets.work')
        ? await tx.ticket.count({
            where: { engineer: { roleId: id }, stage: { in: WORKLOAD_STAGES } },
          })
        : 0;
      return { ...toRow(updated), openTicketsLeftAssigned };
    });
  }

  async remove(actor: AuthUser, id: string, version: number, client: ClientInfo): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, include: COUNT_USERS });
      if (!role) throw notFound();
      if (role.key !== null) {
        throw new AppException(
          'ROLE_BUILT_IN',
          'Built-in roles can’t be deleted. You can rename them or change their permissions.',
          HttpStatus.CONFLICT,
        );
      }
      if (role.version !== version) {
        throw new AppException(
          'VERSION_CONFLICT',
          'Someone else changed this role. Reload to see their changes.',
          HttpStatus.CONFLICT,
        );
      }
      if (role._count.users > 0) {
        throw new AppException(
          'ROLE_IN_USE',
          `${role._count.users === 1 ? '1 person has' : `${role._count.users} people have`} this role. Give them another role first.`,
          HttpStatus.CONFLICT,
        );
      }
      await tx.role.delete({ where: { id } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'role.deleted',
          entityType: 'role',
          entityId: id,
          summary: `${actor.name} deleted the role ${role.name}`,
          ip: client.ip,
          requestId: client.requestId,
        },
        tx,
      );
    });
  }

  private assertGrantable(actor: AuthUser, permissions: Permission[], scope?: TicketScope) {
    if (beyondActor(actor, permissions).length || (scope && scopeBeyondActor(actor, scope))) {
      throw escalation('You can only give a role access that you have yourself.');
    }
  }

  /** Names are unique regardless of case ("Engineer" and "engineer" would confuse people). */
  private async assertNameFree(
    name: string,
    exceptId: string | null,
    tx: Prisma.TransactionClient,
  ) {
    const clash = await tx.role.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw nameTaken();
  }

  /** Two admins saving the same new name at once: the database's unique index decides. */
  private async save<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw nameTaken();
      }
      throw error;
    }
  }
}
