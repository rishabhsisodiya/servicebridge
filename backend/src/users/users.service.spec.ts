import { Logger } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
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
  role: 'ADMIN',
  regionId: null,
  permissions: [],
  sessionId: 's1',
  stepUpAt: null,
};

function target(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u2',
    name: 'Kiran Shetty',
    email: 'kiran@example.com',
    role: 'ENGINEER',
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

function build(found: ReturnType<typeof target> | null, otherAdmins = 1) {
  const tx = {
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
    const { service } = build(target({ id: 'admin-1', role: 'ADMIN' }));
    await expect(
      service.update(admin, 'admin-1', { role: 'ENGINEER', version: 3 }, client),
    ).rejects.toMatchObject({
      code: 'OWN_ROLE',
    });
  });

  it('keeps at least one active administrator', async () => {
    const { service } = build(target({ role: 'ADMIN' }), 0);
    await expect(
      service.update(admin, 'u2', { role: 'ENGINEER', version: 3 }, client),
    ).rejects.toMatchObject({
      code: 'LAST_ADMIN',
    });
  });

  it('audits only what changed and bumps the version', async () => {
    const { service, tx, audit } = build(target());
    const row = await service.update(
      admin,
      'u2',
      { name: 'Kiran Shetty', role: 'AREA_MANAGER', version: 3 },
      client,
    );
    expect(tx.user.update.mock.calls[0][0].data.version).toEqual({ increment: 1 });
    expect(audit.record.mock.calls[0][0].changes).toEqual({
      role: { from: 'ENGINEER', to: 'AREA_MANAGER' },
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
    const { service } = build(target({ id: 'admin-1', role: 'ADMIN' }));
    await expect(service.setActive(admin, 'admin-1', false, client)).rejects.toMatchObject({
      code: 'OWN_ACCOUNT',
    });
  });

  it('protects the last active administrator', async () => {
    const { service } = build(target({ role: 'ADMIN' }), 0);
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
