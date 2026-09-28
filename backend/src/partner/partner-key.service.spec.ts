import { PartnerKeyService } from './partner-key.service';

const creator = {
  id: 'u1',
  name: 'Mira',
  permissions: ['partner.read', 'partner.edit', 'tickets.create', 'tickets.read'],
} as never;
const client = { ip: '127.0.0.1', requestId: 'r1' } as never;

const keyRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'k1',
  name: 'Acme Partner',
  keyHash: 'hashed',
  keyPrefix: 'sbp_9f2kAb12',
  scopes: ['tickets.create'],
  createdById: 'u1',
  createdBy: { id: 'u1', name: 'Mira' },
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date(),
  ...overrides,
});

const makeService = () => {
  const created = keyRow();
  const partnerApiKey = {
    findMany: jest.fn().mockResolvedValue([created]),
    create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      created.keyHash = data.keyHash as string;
      return Promise.resolve({ ...created, ...data, createdBy: { id: 'u1', name: 'Mira' } });
    }),
    findUnique: jest.fn().mockResolvedValue(created),
    update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...created, ...data, createdBy: { id: 'u1', name: 'Mira' } }),
    ),
  };
  const prisma = {
    partnerApiKey,
    $transaction: jest.fn((fn: (tx: { partnerApiKey: unknown }) => Promise<unknown>) =>
      fn({ partnerApiKey }),
    ),
  };
  const audit = { record: jest.fn() };
  const service = new PartnerKeyService(prisma as never, audit as never);
  return { service, prisma, audit, created };
};

describe('PartnerKeyService', () => {
  describe('create', () => {
    it('returns the raw key once and stores only its hash', async () => {
      const { service, prisma, audit } = makeService();
      const { key, rawKey } = await service.create(
        creator,
        { name: 'Acme', scopes: ['tickets.create'] },
        client,
      );
      expect(rawKey).toMatch(/^sbp_[A-Za-z0-9_-]{43}$/);
      expect(key).not.toHaveProperty('keyHash');
      expect(key).not.toHaveProperty('key');
      const stored = (prisma.partnerApiKey.create as jest.Mock).mock.calls[0][0].data;
      expect(stored.keyHash).not.toContain(rawKey);
      expect(stored.keyHash).toHaveLength(64); // SHA-256 hex
      expect(stored.keyPrefix).toBe(rawKey.slice(0, 12));
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'partner.key_created', actorId: 'u1' }),
        expect.anything(),
      );
    });

    it('rejects scopes the creator does not hold', async () => {
      const { service } = makeService();
      await expect(
        service.create(creator, { name: 'Acme', scopes: ['users.delete'] }, client),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('rejects unknown permission names', async () => {
      const { service } = makeService();
      await expect(
        service.create(creator, { name: 'Acme', scopes: ['tickets.nuke'] }, client),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('rejects an empty scope list', async () => {
      const { service } = makeService();
      await expect(service.create(creator, { name: 'Acme', scopes: [] }, client)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });
  });

  describe('revoke', () => {
    it('sets revokedAt and audits the revocation', async () => {
      const { service, prisma, audit } = makeService();
      const revoked = await service.revoke(creator, 'k1', client);
      expect(revoked.revokedAt).toBeInstanceOf(Date);
      expect((prisma.partnerApiKey.update as jest.Mock).mock.calls[0][0].data.revokedAt).toBeInstanceOf(Date);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'partner.key_revoked' }),
        expect.anything(),
      );
    });

    it('is idempotent when already revoked', async () => {
      const { service, prisma } = makeService();
      (prisma.partnerApiKey.findUnique as jest.Mock).mockResolvedValue(
        keyRow({ revokedAt: new Date() }),
      );
      const revoked = await service.revoke(creator, 'k1', client);
      expect(revoked.revokedAt).toBeInstanceOf(Date);
      expect(prisma.partnerApiKey.update).not.toHaveBeenCalled();
    });

    it('404s on an unknown key', async () => {
      const { service, prisma } = makeService();
      (prisma.partnerApiKey.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.revoke(creator, 'nope', client)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('list', () => {
    it('never exposes hashes or raw keys (the non-secret prefix is shown)', async () => {
      const { service } = makeService();
      const [row] = await service.list();
      expect(row).not.toHaveProperty('keyHash');
      // The full 47-char raw key must never appear; only the 12-char prefix does.
      expect(JSON.stringify(row)).not.toMatch(/sbp_[A-Za-z0-9_-]{43}/);
      expect(row.keyPrefix).toBe('sbp_9f2kAb12');
    });
  });
});
