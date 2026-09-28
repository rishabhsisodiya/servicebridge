import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppConfig } from '../core/config/app-config.service';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { generateToken, hashToken } from '../core/security/tokens';
import { notFound } from '../service-rules/common';

type Db = Prisma.TransactionClient;

/**
 * Post-visit satisfaction. A token is minted when a ticket closes; the customer
 * opens a public link, leaves 1–5 stars and an optional comment. Feedback
 * belongs to the ticket and is visible to the service team. Tokens are
 * single-use, URL-safe and hashed at rest, like invite links.
 */
@Injectable()
export class CsatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Mints a feedback token for a ticket. Called inside the ticket-close
   * transaction so the link and the close commit together; returns the token
   * id too, so the caller can mark it emailed.
   */
  async createToken(ticketId: string, db: Db = this.prisma) {
    const token = generateToken();
    const baseUrl = this.config.get('APP_URL').replace(/\/$/, '');
    const url = `${baseUrl}/feedback/${token}`;
    const row = await db.csatToken.create({
      data: { ticketId, tokenHash: hashToken(token), url },
      select: { id: true },
    });
    return { tokenId: row.id, token, url };
  }

  /** What the public page shows before answering. */
  async describe(token: string) {
    const row = await this.findToken(token);
    return {
      ticketNumber: row.ticket.number,
      ticketTitle: row.ticket.title,
      customerName: row.ticket.customer.name,
      answered: row.response !== null,
    };
  }

  /** Records the rating. Single-use: the second submit is rejected. */
  async answer(token: string, rating: number, comment: string | null) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new AppException(
        'CSAT_RATING_INVALID',
        'Give a rating between 1 and 5 stars.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const row = await this.findToken(token);
    if (row.response) {
      throw new AppException(
        'CSAT_ALREADY_ANSWERED',
        'Thanks — this feedback was already recorded.',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction([
      this.prisma.csatResponse.create({
        data: { tokenId: row.id, rating, comment: comment?.trim() || null },
      }),
      this.prisma.csatToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    ]);
    return { recorded: true };
  }

  /** The service team reads a ticket's feedback. */
  async forTicket(ticketId: string, _user: AuthUser) {
    const tokens = await this.prisma.csatToken.findMany({
      where: { ticketId },
      include: { response: true },
      orderBy: { createdAt: 'desc' },
    });
    return tokens.map((t) => ({
      id: t.id,
      createdAt: t.createdAt,
      usedAt: t.usedAt,
      emailed: t.emailed,
      feedbackUrl: t.url,
      rating: t.response?.rating ?? null,
      comment: t.response?.comment ?? null,
      answeredAt: t.response?.createdAt ?? null,
    }));
  }

  async markEmailed(tokenId: string, db: Db = this.prisma): Promise<void> {
    await db.csatToken.update({ where: { id: tokenId }, data: { emailed: true } });
  }

  private async findToken(token: string) {
    const row = await this.prisma.csatToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        response: true,
        ticket: { select: { id: true, number: true, title: true, customer: { select: { name: true } } } },
      },
    });
    if (!row) throw notFound('CSAT_TOKEN_NOT_FOUND', 'feedback link');
    return row;
  }
}
