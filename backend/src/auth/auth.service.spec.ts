import type { JwtService } from '@nestjs/jwt';
import type { AuditService } from '../core/audit/audit.service';
import type { AppConfig } from '../core/config/app-config.service';
import type { PrismaService } from '../core/prisma/prisma.service';
import type { RateLimitService } from '../core/rate-limit/rate-limit.service';
import { hashPassword } from '../core/security/password';
import { AuthService, MAX_FAILED_LOGINS } from './auth.service';
import type { SessionsService } from './sessions.service';
import type { UserTokensService } from './user-tokens.service';

const client = { ip: '10.0.0.9', userAgent: 'jest', requestId: 'r1' };
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword('right-password-1');
});

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'meera@example.com',
    name: 'Meera Iyer',
    roleId: 'role_service_manager',
    role: {
      id: 'role_service_manager',
      name: 'Service manager',
      isLocked: false,
      permissions: ['tickets.assign'],
      ticketScope: 'ALL',
    },
    status: 'ACTIVE',
    passwordHash,
    failedLoginCount: 0,
    lockedUntil: null,
    region: null,
    ...overrides,
  };
}

function build(found: ReturnType<typeof user> | null) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(found),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const next = { ...found };
        const failures = data.failedLoginCount as { increment?: number } | number | undefined;
        if (failures && typeof failures === 'object' && typeof failures.increment === 'number') {
          // Simulates the database's atomic increment: the returned counter is
          // what the service makes its lockout decision from.
          next.failedLoginCount = (found?.failedLoginCount ?? 0) + failures.increment;
        } else {
          Object.assign(next, data);
        }
        return Promise.resolve(next);
      }),
    },
  };
  const sessions = {
    create: jest.fn().mockResolvedValue({ session: { id: 's1' }, refreshToken: 'refresh' }),
  };
  const rateLimit = { enforce: jest.fn().mockResolvedValue(undefined), reset: jest.fn() };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const jwt = { signAsync: jest.fn().mockResolvedValue('access-jwt') };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwt as unknown as JwtService,
    {} as AppConfig,
    sessions as unknown as SessionsService,
    {} as UserTokensService,
    rateLimit as unknown as RateLimitService,
    audit as unknown as AuditService,
  );
  return { service, prisma, sessions, rateLimit, audit };
}

describe('AuthService.login', () => {
  it('signs in with the right password, clears failures and audits it', async () => {
    const { service, prisma, audit } = build(user({ failedLoginCount: 3 }));
    const result = await service.login('  Meera@Example.com ', 'right-password-1', client);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'meera@example.com' } }),
    );
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
      failedLoginCount: 0,
      lockedUntil: null,
    });
    expect(result).toMatchObject({ accessToken: 'access-jwt', refreshToken: 'refresh' });
    expect(result.me.permissions).toContain('tickets.assign');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.signed_in' }),
    );
  });

  it('gives unknown emails the same answer as a wrong password', async () => {
    const { service } = build(null);
    await expect(service.login('nobody@example.com', 'whatever-1', client)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect.',
    });
  });

  it('counts a wrong password with an atomic increment', async () => {
    const { service, prisma } = build(user({ failedLoginCount: 2 }));
    await expect(
      service.login('meera@example.com', 'wrong-password-1', client),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(prisma.user.update.mock.calls[0][0].data.failedLoginCount).toEqual({ increment: 1 });
  });

  it(`locks the account after ${MAX_FAILED_LOGINS} wrong passwords, decided from the fresh counter`, async () => {
    const { service, prisma, audit } = build(user({ failedLoginCount: MAX_FAILED_LOGINS - 1 }));
    await expect(
      service.login('meera@example.com', 'wrong-password-1', client),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    // The first write is the atomic increment; the lockout decision came from
    // the re-read counter, so the account locks even if the login's read was stale.
    expect(prisma.user.update.mock.calls[0][0].data.failedLoginCount).toEqual({ increment: 1 });
    expect(prisma.user.update.mock.calls[1][0].data).toMatchObject({ failedLoginCount: 0 });
    expect(prisma.user.update.mock.calls[1][0].data.lockedUntil).toBeInstanceOf(Date);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.locked' }));
  });

  it('issues one atomic increment per concurrent failure instead of clobbering the counter', async () => {
    const { service, prisma } = build(user({ failedLoginCount: 0 }));
    await Promise.all(
      Array.from({ length: MAX_FAILED_LOGINS }, () =>
        service.login('meera@example.com', 'wrong-password-1', client).catch(() => undefined),
      ),
    );
    const incrementWrites = prisma.user.update.mock.calls.filter(
      (call: unknown[]) =>
        (call[0] as { data?: { failedLoginCount?: { increment?: number } } })?.data
          ?.failedLoginCount?.increment === 1,
    );
    // Every failure issued its own increment write; the database (not the
    // stale read) is what counts, so concurrent failures can't stay at 1.
    expect(incrementWrites).toHaveLength(MAX_FAILED_LOGINS);
  });

  it('refuses a locked account even with the right password', async () => {
    const { service, sessions } = build(user({ lockedUntil: new Date(Date.now() + 60_000) }));
    await expect(
      service.login('meera@example.com', 'right-password-1', client),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
    });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('only reveals deactivation to someone with the right password', async () => {
    const { service } = build(user({ status: 'DEACTIVATED' }));
    await expect(
      service.login('meera@example.com', 'wrong-password-1', client),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    await expect(
      service.login('meera@example.com', 'right-password-1', client),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_DEACTIVATED',
    });
  });

  it('treats an invited user without a password as unknown', async () => {
    const { service } = build(user({ status: 'INVITED', passwordHash: null }));
    await expect(service.login('meera@example.com', 'anything-1', client)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('applies rate limits per address and per email before checking the password', async () => {
    const { service, rateLimit } = build(user());
    await service.login('meera@example.com', 'right-password-1', client);
    expect(rateLimit.enforce).toHaveBeenCalledWith('login:ip:10.0.0.9', 30, 900);
    expect(rateLimit.enforce).toHaveBeenCalledWith('login:email:meera@example.com', 10, 900);
  });
});
