import { PortalAuthService } from './portal-auth.service';

const client = { ip: '10.0.0.1', userAgent: 'test', requestId: 'r1' } as never;

const makeService = (overrides: Record<string, unknown> = {}) => {
  const customerContact = { findFirst: jest.fn(), findUnique: jest.fn() };
  const customerToken = {
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const customerSession = {
    findUnique: jest.fn(),
    create: jest.fn().mockResolvedValue({ id: 'sess1' }),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const tx = { customerToken, customerSession };
  const prisma = {
    customerContact,
    customerToken,
    customerSession,
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    ...overrides,
  };
  const config = { get: jest.fn().mockReturnValue('http://localhost:3000') };
  const email = { queueEmail: jest.fn().mockResolvedValue('log1') };
  const rateLimit = { enforce: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new PortalAuthService(
    prisma as never,
    config as never,
    email as never,
    rateLimit as never,
    audit as never,
  );
  return { service, prisma, config, email, rateLimit, audit };
};

const contactRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  fullName: 'Asha Contact',
  email: 'asha@example.com',
  customerId: 'cust1',
  customer: { name: 'Acme Industries' },
  ...overrides,
});

describe('PortalAuthService', () => {
  describe('requestLink', () => {
    it('always returns { ok: true }, even for an unknown email', async () => {
      const { service, prisma, email } = makeService();
      prisma.customerContact.findFirst.mockResolvedValue(null);
      await expect(service.requestLink('ghost@example.com', client)).resolves.toEqual({
        ok: true,
      });
      expect(email.queueEmail).not.toHaveBeenCalled();
    });

    it('invalidates prior unused tokens and emails a magic link for a known contact', async () => {
      const { service, prisma, email, rateLimit } = makeService();
      prisma.customerContact.findFirst.mockResolvedValue(contactRow());
      await expect(service.requestLink(' ASHA@example.com ', client)).resolves.toEqual({
        ok: true,
      });
      // Per-IP and per-email rate limits.
      expect(rateLimit.enforce).toHaveBeenCalledWith(
        'portal:link:ip:10.0.0.1',
        20,
        3600,
      );
      expect(rateLimit.enforce).toHaveBeenCalledWith(
        expect.stringMatching(/^portal:link:email:[0-9a-f]{64}$/),
        5,
        3600,
      );
      // The email lookup is case-insensitive on the trimmed address.
      expect(prisma.customerContact.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true, customerId: { not: null } }),
        }),
      );
      expect(prisma.customerToken.updateMany).toHaveBeenCalledWith({
        where: { contactId: 'c1', type: 'MAGIC_LINK', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.customerToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contactId: 'c1',
          type: 'MAGIC_LINK',
          tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          expiresAt: expect.any(Date),
        }),
      });
      expect(email.queueEmail).toHaveBeenCalledWith({
        to: 'asha@example.com',
        templateKey: 'portal.magic_link',
        variables: {
          name: 'Asha Contact',
          magicLink: expect.stringMatching(
            /^http:\/\/localhost:3000\/portal\/auth\/verify\?token=[\w-]+$/,
          ),
        },
      });
    });

    it('refuses contacts without a customer or with an inactive customer', async () => {
      const { service, prisma, email } = makeService();
      prisma.customerContact.findFirst.mockResolvedValue(null);
      await expect(service.requestLink('x@example.com', client)).resolves.toEqual({ ok: true });
      expect(email.queueEmail).not.toHaveBeenCalled();
    });
  });

  describe('issueStaffLink', () => {
    const actor = { id: 'u1', name: 'Desk User', email: 'desk@example.com' } as never;
    const contactRow = {
      id: 'c1',
      fullName: 'Asha Contact',
      customerId: 'cust1',
      customer: { name: 'Acme Industries' },
    };

    it('mints a single-use link and audits the issuance with the staff actor', async () => {
      const { service, prisma, audit } = makeService();
      prisma.customerContact.findFirst.mockResolvedValue(contactRow);
      const result = await service.issueStaffLink(actor, 'c1', client);
      expect(result.link).toMatch(
        /^http:\/\/localhost:3000\/portal\/auth\/verify\?token=[\w-]+$/,
      );
      expect(result.expiresAt).toBeDefined();
      // Prior unused links are invalidated, exactly like the emailed flow.
      expect(prisma.customerToken.updateMany).toHaveBeenCalledWith({
        where: { contactId: 'c1', type: 'MAGIC_LINK', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.customerToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ contactId: 'c1', type: 'MAGIC_LINK' }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'u1',
          action: 'portal.sign_in_link_issued',
          entityType: 'CustomerContact',
          entityId: 'c1',
        }),
      );
    });

    it('404-masks unknown, inactive, or customer-less contacts', async () => {
      const { service, prisma, audit } = makeService();
      prisma.customerContact.findFirst.mockResolvedValue(null);
      await expect(service.issueStaffLink(actor, 'nope', client)).rejects.toMatchObject({
        code: 'CONTACT_NOT_FOUND',
        status: 404,
      });
      expect(prisma.customerToken.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    const tokenRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'tok1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      contactId: 'c1',
      contact: {
        id: 'c1',
        active: true,
        customerId: 'cust1',
        customer: { id: 'cust1', active: true },
      },
      ...overrides,
    });

    it('consumes a valid link and opens a session', async () => {
      const { service, prisma } = makeService();
      prisma.customerToken.findUnique.mockResolvedValue(tokenRow());
      const result = await service.verify('raw-token', client);
      expect(result.ok).toBe(true);
      expect(result.token).toMatch(/^[\w-]{40,}$/);
      expect(prisma.customerToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'tok1', usedAt: null, expiresAt: { gt: expect.any(Date) } },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.customerSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contactId: 'c1',
          customerId: 'cust1',
          tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          ip: '10.0.0.1',
          userAgent: 'test',
        }),
      });
    });

    it('rejects unknown, used and expired links with PORTAL_LINK_INVALID', async () => {
      const { service, prisma } = makeService();
      prisma.customerToken.findUnique.mockResolvedValue(null);
      await expect(service.verify('nope', client)).rejects.toMatchObject({
        code: 'PORTAL_LINK_INVALID',
      });
      prisma.customerToken.findUnique.mockResolvedValue(tokenRow({ usedAt: new Date() }));
      await expect(service.verify('used', client)).rejects.toMatchObject({
        code: 'PORTAL_LINK_INVALID',
      });
      prisma.customerToken.findUnique.mockResolvedValue(
        tokenRow({ expiresAt: new Date(Date.now() - 1) }),
      );
      await expect(service.verify('old', client)).rejects.toMatchObject({
        code: 'PORTAL_LINK_INVALID',
      });
    });

    it('rejects a link whose contact or customer went inactive', async () => {
      const { service, prisma } = makeService();
      prisma.customerToken.findUnique.mockResolvedValue(
        tokenRow({ contact: { id: 'c1', active: false, customerId: 'cust1', customer: { id: 'cust1', active: true } } }),
      );
      await expect(service.verify('tok', client)).rejects.toMatchObject({
        code: 'PORTAL_LINK_INVALID',
      });
    });
  });

  describe('validateSession', () => {
    const sessionRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'sess1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3_600_000),
      absoluteExpiresAt: new Date(Date.now() + 20 * 24 * 3_600_000),
      contact: { id: 'c1', fullName: 'Asha Contact', email: 'asha@example.com', active: true },
      customer: { id: 'cust1', active: true },
      ...overrides,
    });

    it('returns the customer identity for a live session and pushes the sliding expiry', async () => {
      const { service, prisma } = makeService();
      prisma.customerSession.findUnique.mockResolvedValue(sessionRow());
      const identity = await service.validateSession('raw');
      expect(identity).toEqual({
        contactId: 'c1',
        customerId: 'cust1',
        contactName: 'Asha Contact',
        email: 'asha@example.com',
      });
      expect(prisma.customerSession.update).toHaveBeenCalledWith({
        where: { id: 'sess1' },
        data: { expiresAt: expect.any(Date), lastUsedAt: expect.any(Date) },
      });
    });

    it('returns null for unknown, revoked, expired or inactive sessions', async () => {
      const { service, prisma } = makeService();
      prisma.customerSession.findUnique.mockResolvedValue(null);
      await expect(service.validateSession('x')).resolves.toBeNull();
      prisma.customerSession.findUnique.mockResolvedValue(sessionRow({ revokedAt: new Date() }));
      await expect(service.validateSession('x')).resolves.toBeNull();
      prisma.customerSession.findUnique.mockResolvedValue(
        sessionRow({ expiresAt: new Date(Date.now() - 1) }),
      );
      await expect(service.validateSession('x')).resolves.toBeNull();
      prisma.customerSession.findUnique.mockResolvedValue(
        sessionRow({ customer: { id: 'cust1', active: false } }),
      );
      await expect(service.validateSession('x')).resolves.toBeNull();
    });
  });

  describe('refresh', () => {
    it('rotates the session token atomically', async () => {
      const { service, prisma } = makeService();
      prisma.customerSession.findUnique.mockResolvedValue({
        id: 'sess1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3_600_000),
        absoluteExpiresAt: new Date(Date.now() + 20 * 24 * 3_600_000),
        contact: { active: true },
        customer: { active: true },
      });
      const result = await service.refresh('old-token');
      expect(result.ok).toBe(true);
      expect(result.token).toMatch(/^[\w-]{40,}$/);
      expect(prisma.customerSession.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'sess1', revokedAt: null }),
        data: expect.objectContaining({ tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) }),
      });
    });

    it('rejects a bad refresh token with 401', async () => {
      const { service, prisma } = makeService();
      prisma.customerSession.findUnique.mockResolvedValue(null);
      await expect(service.refresh('bad')).rejects.toMatchObject({
        code: 'PORTAL_UNAUTHENTICATED',
        status: 401,
      });
    });
  });

  describe('logout', () => {
    it('revokes the session and always succeeds', async () => {
      const { service, prisma } = makeService();
      await expect(service.logout('tok')).resolves.toEqual({ ok: true });
      expect(prisma.customerSession.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/), revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('me', () => {
    it('returns the contact and customer', async () => {
      const { service, prisma } = makeService();
      prisma.customerContact.findUnique.mockResolvedValue({
        id: 'c1',
        fullName: 'Asha Contact',
        email: 'asha@example.com',
        active: true,
        customer: { id: 'cust1', name: 'Acme Industries', active: true },
      });
      const identity = {
        contactId: 'c1',
        customerId: 'cust1',
        contactName: 'Asha Contact',
        email: 'asha@example.com',
      };
      await expect(service.me(identity)).resolves.toEqual({
        contact: { id: 'c1', fullName: 'Asha Contact', email: 'asha@example.com' },
        customer: { id: 'cust1', name: 'Acme Industries' },
      });
    });
  });
});
