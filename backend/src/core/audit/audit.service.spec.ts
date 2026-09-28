import { AuditService } from './audit.service';

const makeService = (overrides: Record<string, unknown> = {}) => {
  const prisma = {
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    appSetting: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
  const service = new AuditService(prisma as never);
  return { service, prisma };
};

describe('AuditService', () => {
  describe('immutability', () => {
    it('exposes no row-mutating methods besides record and purgeOlderThan', () => {
      const proto = Object.getOwnPropertyNames(AuditService.prototype);
      const mutating = ['update', 'delete', 'remove', 'upsert', 'updateMany', 'deleteMany'];
      for (const name of mutating) {
        expect(proto).not.toContain(name);
      }
      expect(proto).toContain('record');
    });
  });

  describe('record', () => {
    it('persists partnerKeyId when present', async () => {
      const { service, prisma } = makeService();
      await service.record({
        actorId: null,
        action: 'partner.ticket_created',
        entityType: 'Ticket',
        summary: 'x',
        partnerKeyId: 'k1',
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ partnerKeyId: 'k1' }) }),
      );
    });
  });

  describe('search', () => {
    it('builds the filter and resolves actor and partner key names', async () => {
      const { service, prisma } = makeService();
      (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'a1',
          action: 'partner.ticket_created',
          entityType: 'Ticket',
          entityId: 't1',
          summary: 'x',
          changes: null,
          ip: '1.2.3.4',
          requestId: 'r1',
          createdAt: new Date(),
          actor: null,
          partnerKey: { id: 'k1', name: 'Acme' },
        },
      ]);
      (prisma.auditLog.count as jest.Mock).mockResolvedValue(1);
      const result = await service.search({
        partnerKeyId: 'k1',
        page: 1,
        pageSize: 25,
        from: new Date('2026-01-01'),
      });
      expect(result.total).toBe(1);
      expect(result.rows[0].partnerKey).toEqual({ id: 'k1', name: 'Acme' });
      const where = (prisma.auditLog.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.partnerKeyId).toBe('k1');
      expect(where.createdAt.gte).toEqual(new Date('2026-01-01'));
    });

    it('caps the page size', async () => {
      const { service, prisma } = makeService();
      await service.search({ page: 1, pageSize: 500 });
      expect((prisma.auditLog.findMany as jest.Mock).mock.calls[0][0].take).toBe(100);
    });
  });

  describe('retention', () => {
    it('defaults to 365 days', async () => {
      const { service } = makeService();
      await expect(service.retentionDays()).resolves.toBe(365);
    });

    it('rejects out-of-range values', async () => {
      const { service } = makeService();
      await expect(
        service.updateRetentionDays(10, { id: 'u1', name: 'M' }, { ip: null, requestId: null }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('purgeOlderThan keeps the newest rows and audits itself', async () => {
      const { service, prisma } = makeService();
      const victims = Array.from({ length: 3 }, (_, i) => ({ id: `old${i}` }));
      (prisma.auditLog.findMany as jest.Mock).mockResolvedValue(victims);
      (prisma.auditLog.deleteMany as jest.Mock).mockResolvedValue({ count: 3 });
      const { deleted } = await service.purgeOlderThan(
        365,
        { id: 'u1', name: 'Mira' },
        { ip: '1.2.3.4', requestId: 'r1' },
      );
      expect(deleted).toBe(3);
      // Keeps the newest 1000 rows regardless of age (skip: 1000).
      expect((prisma.auditLog.findMany as jest.Mock).mock.calls[0][0].skip).toBe(1000);
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'audit.purged', actorId: 'u1' }),
        }),
      );
    });
  });
});
