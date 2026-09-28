import { CsatService } from './csat.service';

const makeService = (prisma: Record<string, unknown>) =>
  new CsatService(prisma as never, { get: () => 'https://app.example.com' } as never);

describe('CsatService', () => {
  describe('answer', () => {
    const answeredRow = (response: unknown) => ({
      id: 'tok1',
      response,
      ticket: { number: 'SB-26-1', title: 'Fix pump', customer: { name: 'Acme' } },
    });

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
  });
});
