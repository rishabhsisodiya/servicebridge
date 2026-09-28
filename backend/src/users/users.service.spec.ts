import { Logger } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { ADMIN_PERMISSIONS, type Permission } from '../auth/permissions';
import type { SessionsService } from '../auth/sessions.service';
import type { UserTokensService } from '../auth/user-tokens.service';
import type { AuditService } from '../core/audit/audit.service';
import type { PrismaService } from '../core/prisma/prisma.service';
import { UsersService } from './users.service';

const client = { ip: null, userAgent: null, requestId: null };
const admin: AuthUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin One',
  roleId: 'role_admin',
  isAdmin: true,
  ticketScope: 'ALL',
  regionId: null,
  permissions: [...ADMIN_PERMISSIONS],
  sessionId: 's1',
  stepUpAt: null,
};

/** A service manager who may manage users but isn't an administrator. */
const manager: AuthUser = {
  ...admin,
  id: 'sm-1',
  name: 'Meera Iyer',
  roleId: 'role_service_manager',
  isAdmin: false,
  permissions: ['tickets.read', 'tickets.assign', 'users.read', 'users.edit', 'users.delete'],
};

const role = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  name: id,
  isLocked: false,
  permissions: ['tickets.read', 'tickets.work'] as Permission[],
  ticketScope: 'OWN',
  ...patch,
});
const ADMIN_ROLE = role('role_admin', {
  name: 'Administrator',
  isLocked: true,
  permissions: [],
  ticketScope: 'ALL',
});
const ENGINEER_ROLE = role('role_engineer', { name: 'Service engineer' });

function target(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u2',
    name: 'Kiran Shetty',
    email: 'kiran@example.com',
    roleId: 'role_engineer',
    role: ENGINEER_ROLE,
    status: 'ACTIVE',
    passwordHash: 'hash',
    regionId: null,
    region: null,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date(),
    version: 3,
    ...overrides,
  };
}

function build(
  found: ReturnType<typeof target> | null,
  otherAdmins = 1,
  roles: Record<string, ReturnType<typeof role>> = {},
) {
  const tx = {
    role: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(roles[where.id] ?? null),
        ),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(found),
      count: jest.fn().mockResolvedValue(otherAdmins),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...found, ...data, version: (found?.version ?? 0) + 1 }),
        ),
    },
    region: { findUnique: jest.fn().mockResolvedValue({ id: 'r1' }) },
    userToken: { updateMany: jest.fn() },
  };
  const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(2) };
  const audit = { record: jest.fn() };
  const service = new UsersService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    sessions as unknown as SessionsService,
    {} as UserTokensService,
    { queueEmail: jest.fn().mockResolvedValue(null) } as never,
  );
  return { service, tx, sessions, audit };
}

beforeAll(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));

describe('UsersService.update', () => {
  it('rejects a stale edit', async () => {
    const { service } = build(target());
    await expect(
      service.update(admin, 'u2', { name: 'New', version: 2 }, client),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
  });

  it("doesn't let admins change their own role", async () => {
    const { service } = build(target({ id: 'admin-1', roleId: 'role_admin', role: ADMIN_ROLE }));
    await expect(
      service.update(admin, 'admin-1', { roleId: 'role_engineer', version: 3 }, client),
    ).rejects.toMatchObject({
      code: 'OWN_ROLE',
    });
  });

  it('keeps at least one active administrator', async () => {
    const { service } = build(target({ roleId: 'role_admin', role: ADMIN_ROLE }), 0);
    await expect(
      service.update(admin, 'u2', { roleId: 'role_engineer', version: 3 }, client),
    ).rejects.toMatchObject({
      code: 'LAST_ADMIN',
    });
  });

  it('audits only what changed and bumps the version', async () => {
    const { service, tx, audit } = build(target(), 1, {
      role_area_manager: role('role_area_manager', { ticketScope: 'REGION' }),
    });
    const row = await service.update(
      admin,
      'u2',
      { name: 'Kiran Shetty', roleId: 'role_area_manager', version: 3 },
      client,
    );
    expect(tx.user.update.mock.calls[0][0].data.version).toEqual({ increment: 1 });
    expect(audit.record.mock.calls[0][0].changes).toEqual({
      roleId: { from: 'role_engineer', to: 'role_area_manager' },
    });
    expect(row.version).toBe(4);
  });

  it('rejects an unknown region as a field error', async () => {
    const { service, tx } = build(target());
    tx.region.findUnique.mockResolvedValue(null);
    await expect(
      service.update(admin, 'u2', { regionId: 'nope', version: 3 }, client),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'regionId', message: 'Choose a region from the list.' }],
    });
  });
});

describe('UsersService.setActive', () => {
  it('deactivates, cancels pending links and signs the user out everywhere', async () => {
    const { service, tx, sessions } = build(target());
    const row = await service.setActive(admin, 'u2', false, client);
    expect(row.status).toBe('DEACTIVATED');
    expect(tx.userToken.updateMany).toHaveBeenCalled();
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u2', 'deactivated');
  });

  it("doesn't let admins deactivate themselves", async () => {
    const { service } = build(target({ id: 'admin-1', roleId: 'role_admin', role: ADMIN_ROLE }));
    await expect(service.setActive(admin, 'admin-1', false, client)).rejects.toMatchObject({
      code: 'OWN_ACCOUNT',
    });
  });

  it('protects the last active administrator', async () => {
    const { service } = build(target({ roleId: 'role_admin', role: ADMIN_ROLE }), 0);
    await expect(service.setActive(admin, 'u2', false, client)).rejects.toMatchObject({
      code: 'LAST_ADMIN',
    });
  });

  it('reactivates someone who never set a password as invited', async () => {
    const { service } = build(target({ status: 'DEACTIVATED', passwordHash: null }));
    const row = await service.setActive(admin, 'u2', true, client);
    expect(row.status).toBe('INVITED');
  });
});

describe('UsersService: no privilege escalation', () => {
  it('rejects a role id that does not exist', async () => {
    const { service } = build(target());
    await expect(
      service.update(admin, 'u2', { roleId: 'nope', version: 3 }, client),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('only administrators give out the Administrator role', async () => {
    const { service } = build(target(), 1, { role_admin: ADMIN_ROLE });
    await expect(
      service.update(manager, 'u2', { roleId: 'role_admin', version: 3 }, client),
    ).rejects.toMatchObject({ code: 'ROLE_ESCALATION' });
  });

  it('blocks giving a role with permissions the actor lacks', async () => {
    const auditor = role('role_auditor', { permissions: ['audit.read'], ticketScope: 'OWN' });
    const { service } = build(target(), 1, { role_auditor: auditor });
    await expect(
      service.update(manager, 'u2', { roleId: 'role_auditor', version: 3 }, client),
    ).rejects.toMatchObject({ code: 'ROLE_ESCALATION' });
  });

  it('lets anyone hand out engineer membership they do not hold themselves', async () => {
    const { service } = build(
      target({ roleId: 'role_desk', role: role('role_desk', { permissions: ['tickets.read'] }) }),
      1,
      {
        role_engineer: ENGINEER_ROLE,
      },
    );
    const row = await service.update(
      manager,
      'u2',
      { roleId: 'role_engineer', version: 3 },
      client,
    );
    expect(row.version).toBe(4);
  });

  it("stops non-administrators taking over an administrator's account", async () => {
    const { service } = build(target({ roleId: 'role_admin', role: ADMIN_ROLE }));
    await expect(service.setActive(manager, 'u2', false, client)).rejects.toMatchObject({
      code: 'ROLE_ESCALATION',
    });
  });
});
