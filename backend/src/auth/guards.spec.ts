import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import type { AppConfig } from '../core/config/app-config.service';
import { diffFields } from '../core/audit/audit.service';
import { AuthGuard } from './auth.guard';
import { IS_PUBLIC, RECENT_AUTH_MINUTES, REQUIRED_PERMISSIONS } from './decorators';
import { OriginGuard } from './origin.guard';
import type { SessionsService } from './sessions.service';

function context(request: Record<string, unknown>, metadata: Record<string, unknown> = {}) {
  const handler = () => undefined;
  return {
    ctx: {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
    reflector: { getAllAndOverride: (key: string) => metadata[key] } as unknown as Reflector,
  };
}

const activeSession = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  stepUpAt: null,
  user: {
    id: 'u1',
    email: 'a@b.c',
    name: 'A',
    roleId: 'role_engineer',
    role: { isLocked: false, permissions: ['tickets.work'], ticketScope: 'OWN' },
    regionId: 'r1',
  },
  ...overrides,
});

function guard(
  metadata: Record<string, unknown>,
  verify: () => Promise<unknown>,
  session: unknown,
) {
  const request: Record<string, unknown> = { headers: {}, cookies: { sb_access: 'token' } };
  const { ctx, reflector } = context(request, metadata);
  const jwt = { verifyAsync: jest.fn(verify) } as unknown as JwtService;
  const sessions = {
    findActive: jest.fn().mockResolvedValue(session),
  } as unknown as SessionsService;
  return { run: () => new AuthGuard(reflector, jwt, sessions).canActivate(ctx), request };
}

const claims = () => Promise.resolve({ sub: 'u1', sid: 's1' });

describe('AuthGuard', () => {
  it('lets public routes through without a token', async () => {
    const { run } = guard(
      { [IS_PUBLIC]: true },
      () => Promise.reject(new Error('should not verify')),
      null,
    );
    await expect(run()).resolves.toBe(true);
  });

  it('attaches the user with permissions from their role', async () => {
    const { run, request } = guard({}, claims, activeSession());
    await expect(run()).resolves.toBe(true);
    expect(request.user).toMatchObject({
      id: 'u1',
      roleId: 'role_engineer',
      isAdmin: false,
      ticketScope: 'OWN',
      sessionId: 's1',
    });
    // The implied read permission is added to what the role stores.
    expect((request.user as { permissions: string[] }).permissions).toEqual([
      'tickets.read',
      'tickets.work',
    ]);
  });

  it('asks the web app to refresh when the access token expired', async () => {
    const { run } = guard(
      {},
      () => Promise.reject(new TokenExpiredError('jwt expired', new Date())),
      null,
    );
    await expect(run()).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('rejects a token whose session was revoked or whose user was deactivated', async () => {
    const { run } = guard({}, claims, null);
    await expect(run()).rejects.toMatchObject({ code: 'SESSION_ENDED' });
  });

  it('enforces required permissions', async () => {
    const { run } = guard({ [REQUIRED_PERMISSIONS]: ['users.read'] }, claims, activeSession());
    await expect(run()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('gives the locked Administrator role every permission except engineer and escalation membership', async () => {
    const { run, request } = guard(
      { [REQUIRED_PERMISSIONS]: ['roles.delete'] },
      claims,
      activeSession({
        user: {
          ...activeSession().user,
          role: { isLocked: true, permissions: [], ticketScope: 'ALL' },
        },
      }),
    );
    await expect(run()).resolves.toBe(true);
    const { permissions, isAdmin } = request.user as { permissions: string[]; isAdmin: boolean };
    expect(isAdmin).toBe(true);
    expect(permissions).toContain('users.delete');
    expect(permissions).not.toContain('tickets.work');
    expect(permissions).not.toContain('tickets.escalations');
  });

  it('requires a recent password confirmation when asked', async () => {
    const stale = guard(
      { [RECENT_AUTH_MINUTES]: 10 },
      claims,
      activeSession({ stepUpAt: new Date(Date.now() - 11 * 60_000) }),
    );
    await expect(stale.run()).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    const fresh = guard(
      { [RECENT_AUTH_MINUTES]: 10 },
      claims,
      activeSession({ stepUpAt: new Date() }),
    );
    await expect(fresh.run()).resolves.toBe(true);
  });
});

describe('OriginGuard', () => {
  const config = {
    get: (key: string) =>
      key === 'APP_URL' ? 'https://app.example.com' : ['http://localhost:3000'],
  } as unknown as AppConfig;
  const run = (method: string, origin?: string) =>
    new OriginGuard(config).canActivate(context({ method, headers: origin ? { origin } : {} }).ctx);

  it('allows reads, same-site writes and requests without an Origin', () => {
    expect(run('GET', 'https://evil.example')).toBe(true);
    expect(run('POST', 'https://app.example.com')).toBe(true);
    expect(run('POST', 'http://localhost:3000')).toBe(true);
    expect(run('POST')).toBe(true);
  });

  it('rejects writes from other sites', () => {
    let thrown: unknown;
    try {
      run('POST', 'https://evil.example');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
  });
});

describe('diffFields', () => {
  it('records only changed fields and masks secrets', () => {
    expect(
      diffFields(
        { name: 'A', role: 'ENGINEER', passwordHash: 'x' },
        { name: 'A', role: 'ADMIN', passwordHash: 'y' },
      ),
    ).toEqual({
      role: { from: 'ENGINEER', to: 'ADMIN' },
      passwordHash: { from: '[redacted]', to: '[redacted]' },
    });
  });
});

// Keep the real classes referenced so this file fails loudly if their exports move.
void JwtService;
void Reflector;
