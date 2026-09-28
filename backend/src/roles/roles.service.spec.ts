import type { AuthUser } from '../auth/auth.types';
import { ADMIN_PERMISSIONS } from '../auth/permissions';
import type { AuditService } from '../core/audit/audit.service';
import type { PrismaService } from '../core/prisma/prisma.service';
import { RolesService } from './roles.service';

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
/** Can edit roles but only holds ticket and role permissions, and sees their region only. */
const lead: AuthUser = {
  ...admin,
  id: 'lead-1',
  name: 'Team Lead',
  roleId: 'role_lead',
  isAdmin: false,
  ticketScope: 'REGION',
  permissions: ['tickets.read', 'tickets.assign', 'roles.read', 'roles.create', 'roles.edit'],
};

const role = (patch: Record<string, unknown> = {}) => ({
  id: 'role_x',
  key: null,
  name: 'Dispatcher',
  description: null,
  isLocked: false,
  permissions: ['tickets.read', 'tickets.assign'],
  ticketScope: 'REGION',
  version: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { users: 0 },
  ...patch,
});

function build(
  found: ReturnType<typeof role> | null,
  options: { clash?: boolean; open?: number } = {},
) {
  const tx = {
    role: {
      findUnique: jest.fn().mockResolvedValue(found),
      findFirst: jest.fn().mockResolvedValue(options.clash ? { id: 'other' } : null),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve(role({ ...data, id: 'role_new', version: 1 })),
        ),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...found,
          ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
          version: (found?.version ?? 0) + 1,
        }),
      ),
      delete: jest.fn().mockResolvedValue(found),
    },
    ticket: { count: jest.fn().mockResolvedValue(options.open ?? 0) },
  };
  const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
  const audit = { record: jest.fn() };
  const service = new RolesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, tx, audit };
}

describe('RolesService.create', () => {
  it('normalises permissions and audits the new role', async () => {
    const { service, tx, audit } = build(null);
    const row = await service.create(
      admin,
      { name: ' Dispatcher ', ticketScope: 'REGION', permissions: ['tickets.assign', 'bogus'] },
      client,
    );
    expect(tx.role.create.mock.calls[0][0].data).toMatchObject({
      name: 'Dispatcher',
      permissions: ['tickets.read', 'tickets.assign'],
    });
    expect(row.isBuiltIn).toBe(false);
    expect(audit.record.mock.calls[0][0].action).toBe('role.created');
  });

  it('copies permissions and scope from another role', async () => {
    const { service, tx } = build(
      role({ permissions: ['tickets.read', 'tickets.work'], ticketScope: 'OWN' }),
    );
    await service.create(admin, { name: 'Senior engineer', copyFromId: 'role_x' }, client);
    expect(tx.role.create.mock.calls[0][0].data).toMatchObject({
      permissions: ['tickets.read', 'tickets.work'],
      ticketScope: 'OWN',
    });
  });

  it('needs a ticket scope when not copying', async () => {
    const { service } = build(null);
    await expect(service.create(admin, { name: 'Dispatcher' }, client)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('rejects a name another role has, ignoring case', async () => {
    const { service } = build(null, { clash: true });
    await expect(
      service.create(admin, { name: 'dispatcher', ticketScope: 'ALL' }, client),
    ).rejects.toMatchObject({ code: 'ROLE_NAME_TAKEN' });
  });

  it('stops non-administrators granting permissions or scope they lack', async () => {
    const { service } = build(null);
    await expect(
      service.create(
        lead,
        { name: 'Auditor', ticketScope: 'OWN', permissions: ['audit.read'] },
        client,
      ),
    ).rejects.toMatchObject({ code: 'ROLE_ESCALATION' });
    await expect(
      service.create(
        lead,
        { name: 'Viewer', ticketScope: 'ALL', permissions: ['tickets.read'] },
        client,
      ),
    ).rejects.toMatchObject({ code: 'ROLE_ESCALATION' });
  });

  it('lets non-administrators grant engineer membership', async () => {
    const { service } = build(null);
    const row = await service.create(
      lead,
      { name: 'Field engineer', ticketScope: 'OWN', permissions: ['tickets.work'] },
      client,
    );
    expect(row.permissions).toEqual(['tickets.read', 'tickets.work']);
  });
});

describe('RolesService.update', () => {
  it('never changes the locked Administrator role', async () => {
    const { service } = build(role({ isLocked: true, key: 'ADMIN' }));
    await expect(
      service.update(admin, 'role_admin', { name: 'Boss', version: 2 }, client),
    ).rejects.toMatchObject({ code: 'ROLE_LOCKED' });
  });

  it('rejects a stale edit', async () => {
    const { service } = build(role());
    await expect(
      service.update(admin, 'role_x', { name: 'New', version: 1 }, client),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('audits added and removed permissions', async () => {
    const { service, audit } = build(role());
    await service.update(
      admin,
      'role_x',
      { permissions: ['tickets.read', 'tickets.verify'], version: 2 },
      client,
    );
    expect(audit.record.mock.calls[0][0].changes).toEqual({
      permissions: { from: ['tickets.assign'], to: ['tickets.verify'] },
    });
  });

  it('lets non-administrators remove access they do not hold, but not add it', async () => {
    const withAudit = role({ permissions: ['tickets.read', 'tickets.assign', 'audit.read'] });
    const removing = build(withAudit);
    await expect(
      removing.service.update(
        lead,
        'role_x',
        { permissions: ['tickets.read'], version: 2 },
        client,
      ),
    ).resolves.toMatchObject({ permissions: ['tickets.read'] });

    const adding = build(role());
    await expect(
      adding.service.update(
        lead,
        'role_x',
        { permissions: ['tickets.read', 'erp.edit'], version: 2 },
        client,
      ),
    ).rejects.toMatchObject({ code: 'ROLE_ESCALATION' });
  });

  it('reports open tickets left with people who stop being engineers', async () => {
    const { service, tx } = build(role({ permissions: ['tickets.read', 'tickets.work'] }), {
      open: 3,
    });
    const row = await service.update(
      admin,
      'role_x',
      { permissions: ['tickets.read'], version: 2 },
      client,
    );
    expect(row.openTicketsLeftAssigned).toBe(3);
    expect(tx.ticket.count).toHaveBeenCalled();
  });
});

describe('RolesService.remove', () => {
  it('refuses built-in roles', async () => {
    const { service } = build(role({ key: 'ENGINEER' }));
    await expect(service.remove(admin, 'role_x', 2, client)).rejects.toMatchObject({
      code: 'ROLE_BUILT_IN',
    });
  });

  it('refuses roles people still have', async () => {
    const { service } = build(role({ _count: { users: 2 } }));
    await expect(service.remove(admin, 'role_x', 2, client)).rejects.toMatchObject({
      code: 'ROLE_IN_USE',
      message: '2 people have this role. Give them another role first.',
    });
  });

  it('deletes an unused custom role and audits it', async () => {
    const { service, tx, audit } = build(role());
    await service.remove(admin, 'role_x', 2, client);
    expect(tx.role.delete).toHaveBeenCalledWith({ where: { id: 'role_x' } });
    expect(audit.record.mock.calls[0][0].action).toBe('role.deleted');
  });
});
