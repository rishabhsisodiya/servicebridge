import { CsatService } from './csat.service';

const makeService = (prisma: Record<string, unknown>) =>
  new CsatService(prisma as never, { get: () => 'https://app.example.com' } as never);

const allUser = { id: 'u1', ticketScope: 'ALL', regionId: null } as never;
const ownUser = { id: 'eng1', ticketScope: 'OWN', regionId: null } as never;

const catchError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; getStatus: () => number };
  }
  throw new Error('Expected the promise to reject, but it resolved.');
};

describe('CsatService', () => {
  const answeredRow = (response: unknown, extra: Record<string, unknown> = {}) => ({
    id: 'tok1',
    response,
    expiresAt: null,
    ticket: { number: 'ET-26-1', title: 'Fix pump', customer: { name: 'Acme' } },
    ...extra,
  });

  const answerError = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      const e = error as { code?: string; getStatus?: () => number };
      return { code: e.code, status: e.getStatus?.() };
    }
    throw new Error('Expected the promise to reject, but it resolved.');
  };

  describe('answer', () => {
    it('rejects ratings outside 1–5', async () => {
      const service = makeService({});
      await expect(service.answer('t', 0, null)).rejects.toMatchObject({ code: 'CSAT_RATING_INVALID' });
      await expect(service.answer('t', 6, null)).rejects.toMatchObject({ code: 'CSAT_RATING_INVALID' });
    });

    it('rejects a second answer on a used token', async () => {
      const prisma = {
        csatToken: {
          findUnique: jest.fn().mockResolvedValue(answeredRow({ id: 'r1', rating: 5 })),
        },
      };
      const service = makeService(prisma);
      await expect(service.answer('t', 4, null)).rejects.toMatchObject({ code: 'CSAT_ALREADY_ANSWERED' });
    });

    it('records the rating and marks the token used', async () => {
      const create = jest.fn();
      const update = jest.fn();
      const prisma = {
        csatToken: {
          findUnique: jest.fn().mockResolvedValue(answeredRow(null)),
          update,
        },
        csatResponse: { create },
        $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      };
      const service = makeService(prisma);
      await expect(service.answer('t', 5, '  Great work  ')).resolves.toEqual({ recorded: true });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ rating: 5, comment: 'Great work' }) }),
      );
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ usedAt: expect.any(Date) }) }),
      );
    });

    it('rejects an unknown token', async () => {
      const prisma = { csatToken: { findUnique: jest.fn().mockResolvedValue(null) } };
      const service = makeService(prisma);
      await expect(service.answer('nope', 5, null)).rejects.toMatchObject({
        code: 'CSAT_TOKEN_NOT_FOUND',
      });
    });

    it('rejects an expired token in answer (SB-L4)', async () => {
      const prisma = {
        csatToken: {
          findUnique: jest.fn().mockResolvedValue(
            answeredRow(null, { expiresAt: new Date('2020-01-01T00:00:00Z') }),
          ),
        },
      };
      const service = makeService(prisma);
      const error = await answerError(service.answer('t', 5, null));
      expect(error).toMatchObject({ code: 'CSAT_EXPIRED', status: 410 });
    });

    it('accepts a token minted within its 90-day window', async () => {
      const create = jest.fn();
      const update = jest.fn();
      const prisma = {
        csatToken: {
          findUnique: jest.fn().mockResolvedValue(
            answeredRow(null, { expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }),
          ),
          update,
        },
        csatResponse: { create },
        $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      };
      const service = makeService(prisma);
      await expect(service.answer('t', 5, null)).resolves.toEqual({ recorded: true });
    });
  });

  describe('describe', () => {
    it('rejects an expired token (SB-L4)', async () => {
      const prisma = {
        csatToken: {
          findUnique: jest.fn().mockResolvedValue(
            answeredRow(null, { expiresAt: new Date('2020-01-01T00:00:00Z') }),
          ),
        },
      };
      const service = makeService(prisma);
      const error = await answerError(service.describe('t'));
      expect(error).toMatchObject({ code: 'CSAT_EXPIRED', status: 410 });
    });

    it('describes a live token', async () => {
      const prisma = {
        csatToken: {
          findUnique: jest.fn().mockResolvedValue(
            answeredRow(null, { expiresAt: new Date(Date.now() + 24 * 3600 * 1000) }),
          ),
        },
      };
      const service = makeService(prisma);
      await expect(service.describe('t')).resolves.toMatchObject({
        ticketNumber: 'ET-26-1',
        answered: false,
      });
    });

    it('describes a legacy token with no expiry', async () => {
      const prisma = {
        csatToken: { findUnique: jest.fn().mockResolvedValue(answeredRow(null, {})) },
      };
      const service = makeService(prisma);
      await expect(service.describe('t')).resolves.toMatchObject({ ticketNumber: 'ET-26-1' });
    });
  });

  describe('forTicket', () => {
    const tokenRow = {
      id: 'tok1',
      createdAt: new Date('2026-09-20T10:00:00Z'),
      usedAt: null,
      emailed: true,
      url: 'https://app.example.com/feedback/secret',
      response: null,
    };

    const build = (ticketRow: unknown) => {
      const ticket = { findFirst: jest.fn().mockResolvedValue(ticketRow) };
      const csatToken = { findMany: jest.fn().mockResolvedValue([tokenRow]) };
      return { service: makeService({ ticket, csatToken }), ticket, csatToken };
    };

    it('404s for a ticket outside the caller’s scope (SB-L3)', async () => {
      const { service } = build(null);
      const error = await catchError(service.forTicket('t9', ownUser));
      expect(error).toMatchObject({ code: 'TICKET_NOT_FOUND' });
      expect(error.getStatus()).toBe(404);
    });

    it('applies the caller’s ticket scope to the visibility check (SB-L3)', async () => {
      const { service, ticket } = build({ id: 't1' });
      await service.forTicket('t1', ownUser);
      expect(ticket.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ engineerId: 'eng1' }, { createdById: 'eng1' }],
          }),
        }),
      );
    });

    it('returns feedback without the raw token-bearing link (SB-M7)', async () => {
      const { service } = build({ id: 't1' });
      const rows = await service.forTicket('t1', allUser);
      expect(rows).toHaveLength(1);
      expect(rows[0]).not.toHaveProperty('feedbackUrl');
      expect(rows[0]).toMatchObject({ id: 'tok1', emailed: true, rating: null });
    });
  });

  describe('surveyLink', () => {
    const build = (ticketRow: unknown) => {
      const ticket = { findFirst: jest.fn().mockResolvedValue(ticketRow) };
      const csatToken = {
        findFirst: jest.fn().mockResolvedValue({ url: 'https://app.example.com/feedback/secret' }),
      };
      return { service: makeService({ ticket, csatToken }), ticket };
    };

    it('404s for a ticket outside the caller’s scope', async () => {
      const { service } = build(null);
      const error = await catchError(service.surveyLink('t9', ownUser));
      expect(error).toMatchObject({ code: 'TICKET_NOT_FOUND' });
      expect(error.getStatus()).toBe(404);
    });

    it('returns the raw link for a visible ticket', async () => {
      const { service } = build({ id: 't1' });
      await expect(service.surveyLink('t1', allUser)).resolves.toEqual({
        feedbackUrl: 'https://app.example.com/feedback/secret',
      });
    });

    it('returns null when no token was minted yet', async () => {
      const ticket = { findFirst: jest.fn().mockResolvedValue({ id: 't1' }) };
      const csatToken = { findFirst: jest.fn().mockResolvedValue(null) };
      const service = makeService({ ticket, csatToken });
      await expect(service.surveyLink('t1', allUser)).resolves.toEqual({ feedbackUrl: null });
    });
  });

  describe('createToken / tokenForTicket', () => {
    it('sets the expiry 90 days out at mint', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'tok1' });
      const service = makeService({ csatToken: { create } });
      const before = Date.now();
      await service.createToken('t1');
      const data = create.mock.calls[0][0].data;
      const ttl = data.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan(89 * 24 * 3600 * 1000);
      // The mint's own Date.now() ticks after `before`, so allow a small epsilon.
      expect(ttl).toBeLessThanOrEqual(90 * 24 * 3600 * 1000 + 1000);
    });

    it('reuses the existing token instead of minting a second one', async () => {
      const create = jest.fn();
      const findUnique = jest
        .fn()
        .mockResolvedValue({ id: 'tok1', url: 'https://app.example.com/feedback/secret' });
      const service = makeService({ csatToken: { create, findUnique } });
      await expect(service.tokenForTicket('t1')).resolves.toEqual({
        tokenId: 'tok1',
        url: 'https://app.example.com/feedback/secret',
      });
      expect(create).not.toHaveBeenCalled();
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ticketId: 't1' } }),
      );
    });

    it('mints when no token exists yet', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'tok1' });
      const findUnique = jest.fn().mockResolvedValue(null);
      const service = makeService({ csatToken: { create, findUnique } });
      const result = await service.tokenForTicket('t1');
      expect(create).toHaveBeenCalled();
      expect(result.tokenId).toBe('tok1');
    });
  });
});
