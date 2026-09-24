import { Logger } from '@nestjs/common';
import type { AppConfig } from '../core/config/app-config.service';
import type { PrismaService } from '../core/prisma/prisma.service';
import { hashToken } from '../core/security/tokens';
import { ROTATION_GRACE_MS, SessionsService } from './sessions.service';

const client = { ip: '10.0.0.1', userAgent: 'jest', requestId: null };
const config = {
  get: (key: string) => ({ SESSION_IDLE_DAYS: 14, SESSION_MAX_DAYS: 30 })[key],
} as unknown as AppConfig;

function session(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: 's1',
    userId: 'u1',
    tokenHash: hashToken('current'),
    previousTokenHash: hashToken('previous'),
    rotatedAt: new Date(now - 5_000),
    expiresAt: new Date(now + 86_400_000),
    absoluteExpiresAt: new Date(now + 10 * 86_400_000),
    revokedAt: null,
    user: { id: 'u1', status: 'ACTIVE' },
    ...overrides,
  };
}

function build(row: ReturnType<typeof session> | null, updateCount = 1) {
  const prisma = {
    session: {
      findFirst: jest.fn().mockResolvedValue(row),
      findUnique: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
    },
  };
  return { service: new SessionsService(prisma as unknown as PrismaService, config), prisma };
}

describe('SessionsService.rotate', () => {
  beforeAll(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));

  it('issues a new refresh token for the current one and keeps the old hash as previous', async () => {
    const { service, prisma } = build(session());
    const result = await service.rotate('current', client);
    expect(result.refreshToken).toBeDefined();
    const update = prisma.session.updateMany.mock.calls[0][0];
    expect(update.where).toMatchObject({ id: 's1', tokenHash: hashToken('current') });
    expect(update.data.previousTokenHash).toBe(hashToken('current'));
    expect(update.data.tokenHash).toBe(hashToken(result.refreshToken!));
  });

  it('never extends a session past its absolute expiry', async () => {
    const absolute = new Date(Date.now() + 60_000);
    const { service, prisma } = build(session({ absoluteExpiresAt: absolute }));
    await service.rotate('current', client);
    expect(prisma.session.updateMany.mock.calls[0][0].data.expiresAt).toEqual(absolute);
  });

  it('lets a second tab use the previous token within the grace window without rotating', async () => {
    const { service, prisma } = build(
      session({ rotatedAt: new Date(Date.now() - ROTATION_GRACE_MS / 2) }),
    );
    const result = await service.rotate('previous', client);
    expect(result.refreshToken).toBeUndefined();
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });

  it('revokes the session when a previous token is replayed after the grace window', async () => {
    const { service, prisma } = build(
      session({ rotatedAt: new Date(Date.now() - ROTATION_GRACE_MS - 1) }),
    );
    await expect(service.rotate('previous', client)).rejects.toMatchObject({
      code: 'SESSION_ENDED',
    });
    expect(prisma.session.updateMany.mock.calls[0][0].data.revokedReason).toBe(
      'refresh_token_reuse',
    );
  });

  it('treats losing a concurrent rotation like the grace case', async () => {
    const lost = session({
      tokenHash: hashToken('someone-else'),
      previousTokenHash: hashToken('current'),
      rotatedAt: new Date(),
    });
    const { service, prisma } = build(session(), 0);
    prisma.session.findUnique.mockResolvedValue(lost);
    const result = await service.rotate('current', client);
    expect(result.refreshToken).toBeUndefined();
  });

  it.each([
    ['unknown token', null],
    ['revoked session', session({ revokedAt: new Date() })],
    ['idle-expired session', session({ expiresAt: new Date(Date.now() - 1) })],
    ['past absolute expiry', session({ absoluteExpiresAt: new Date(Date.now() - 1) })],
  ])('rejects a %s', async (_label, row) => {
    const { service } = build(row);
    await expect(service.rotate('current', client)).rejects.toMatchObject({
      code: 'SESSION_ENDED',
    });
  });
});
