import { Reflector } from '@nestjs/core';
import { hashToken } from '../core/security/tokens';
import { PARTNER_SCOPES, PartnerGuard } from './partner.guard';

const RAW_KEY = 'sbp_' + 'a'.repeat(43);

const keyRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'k1',
  name: 'Acme',
  keyHash: hashToken(RAW_KEY),
  keyPrefix: RAW_KEY.slice(0, 12),
  scopes: ['tickets.create', 'tickets.read'],
  revokedAt: null,
  expiresAt: null,
  ...overrides,
});

const makeGuard = (key: unknown, requiredScopes?: string[]) => {
  const prisma = {
    partnerApiKey: {
      findUnique: jest.fn().mockResolvedValue(key),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const rateLimit = { enforce: jest.fn().mockResolvedValue(undefined) };
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredScopes),
  } as unknown as Reflector;
  const guard = new PartnerGuard(reflector, prisma as never, rateLimit as never);
  return { guard, prisma, rateLimit };
};

interface TestContext {
  switchToHttp: () => { getRequest: () => TestRequest };
  getHandler: () => Record<string, unknown>;
  getClass: () => Record<string, unknown>;
  request: TestRequest;
}

interface TestRequest {
  headers: Record<string, string>;
  ip: string;
  partner?: { keyId: string; name: string; permissions: string[] };
}

const contextOf = (authorization?: string): TestContext => {
  const request: TestRequest = {
    headers: authorization ? { authorization } : {},
    ip: '10.0.0.1',
    partner: undefined,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
    request,
  };
};

describe('PartnerGuard', () => {
  it('authenticates a valid key and attaches the partner identity', async () => {
    const { guard, prisma } = makeGuard(keyRow(), ['tickets.create']);
    const ctx = contextOf(`Bearer ${RAW_KEY}`);
    await expect(guard.canActivate(ctx as never)).resolves.toBe(true);
    expect(ctx.request.partner).toEqual({
      keyId: 'k1',
      name: 'Acme',
      permissions: ['tickets.create', 'tickets.read'],
    });
    expect(prisma.partnerApiKey.findUnique).toHaveBeenCalledWith({
      where: { keyHash: hashToken(RAW_KEY) },
    });
    // lastUsedAt is updated best-effort.
    expect(prisma.partnerApiKey.update).toHaveBeenCalled();
  });

  it('rejects a missing bearer token', async () => {
    const { guard } = makeGuard(keyRow());
    await expect(guard.canActivate(contextOf() as never)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a non-partner bearer token without a DB lookup', async () => {
    const { guard, prisma } = makeGuard(keyRow());
    await expect(guard.canActivate(contextOf('Bearer jwt.access.token') as never)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(prisma.partnerApiKey.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown key with no detail', async () => {
    const { guard } = makeGuard(null);
    const error = await guard.canActivate(contextOf(`Bearer ${RAW_KEY}`) as never).catch((e) => e);
    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.message).not.toContain('k1');
  });

  it('rejects a revoked key', async () => {
    const { guard } = makeGuard(keyRow({ revokedAt: new Date() }));
    await expect(guard.canActivate(contextOf(`Bearer ${RAW_KEY}`) as never)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects an expired key', async () => {
    const { guard } = makeGuard(keyRow({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(guard.canActivate(contextOf(`Bearer ${RAW_KEY}`) as never)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects when the key lacks the required scope', async () => {
    const { guard } = makeGuard(keyRow({ scopes: ['tickets.read'] }), ['tickets.create']);
    await expect(guard.canActivate(contextOf(`Bearer ${RAW_KEY}`) as never)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rate-limits per key after authentication', async () => {
    const { guard, rateLimit } = makeGuard(keyRow(), ['tickets.create']);
    await guard.canActivate(contextOf(`Bearer ${RAW_KEY}`) as never);
    expect(rateLimit.enforce).toHaveBeenCalledWith('partner:key:k1', 300, 60);
  });

  it('reads required scopes from handler metadata', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['tickets.read']) };
    expect(reflector.getAllAndOverride(PARTNER_SCOPES, [{}, {}])).toEqual(['tickets.read']);
  });
});
