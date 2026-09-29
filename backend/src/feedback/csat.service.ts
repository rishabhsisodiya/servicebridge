import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppConfig } from '../core/config/app-config.service';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { generateToken, hashToken } from '../core/security/tokens';
import { notFound } from '../service-rules/common';
import { visibleTo } from '../tickets/visibility';

type Db = Prisma.TransactionClient;

/** Survey links live 90 days after minting (SB-L4). */
const CSAT_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const ticketNotFound = () =>
  new AppException(
    'TICKET_NOT_FOUND',
    "That ticket doesn't exist, or you can't see it.",
    HttpStatus.NOT_FOUND,
  );

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
   * id too, so the caller can mark it emailed. The link expires 90 days
   * after minting (SB-L4).
   */
  async createToken(ticketId: string, db: Db = this.prisma) {
    const token = generateToken();
    const baseUrl = this.config.get('APP_URL').replace(/\/$/, '');
    const url = `${baseUrl}/feedback/${token}`;
    const row = await db.csatToken.create({
      data: {
        ticketId,
        tokenHash: hashToken(token),
        url,
        expiresAt: new Date(Date.now() + CSAT_TOKEN_TTL_MS),
      },
      select: { id: true },
    });
    return { tokenId: row.id, token, url };
  }

  /**
   * One token per ticket (CsatToken.ticketId is unique): reuses the existing
   * survey link when a reopened ticket is closed again, instead of failing
   * on the unique constraint.
   */
  async tokenForTicket(
    ticketId: string,
    db: Db = this.prisma,
  ): Promise<{ tokenId: string; url: string | null }> {
    const existing = await db.csatToken.findUnique({
      where: { ticketId },
      select: { id: true, url: true },
    });
    if (existing) return { tokenId: existing.id, url: existing.url };
    return this.createToken(ticketId, db);
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

  /**
   * The service team reads a ticket's feedback. Ticket visibility applies
   * (SB-L3): feedback for a ticket the caller can't see is a 404, and the
   * raw token-bearing link is never included here — staff who need to copy
   * it use surveyLink() (SB-M7).
   */
  async forTicket(ticketId: string, user: AuthUser) {
    await this.visibleTicketId(ticketId, user);
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
      rating: t.response?.rating ?? null,
      comment: t.response?.comment ?? null,
      answeredAt: t.response?.createdAt ?? null,
    }));
  }

  /**
   * The raw token-bearing survey URL, for staff who need to copy it to the
   * customer. The route requires tickets.edit on top of ticket visibility;
   * the URL never appears in list/detail responses.
   */
  async surveyLink(ticketId: string, user: AuthUser): Promise<{ feedbackUrl: string | null }> {
    await this.visibleTicketId(ticketId, user);
    const token = await this.prisma.csatToken.findFirst({
      where: { ticketId },
      orderBy: { createdAt: 'desc' },
      select: { url: true },
    });
    return { feedbackUrl: token?.url ?? null };
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
    // Tokens without an expiry predate SB-L4 and keep working; minted ones
    // die 90 days after the close.
    if (row.expiresAt && row.expiresAt < new Date()) {
      throw new AppException(
        'CSAT_EXPIRED',
        'This feedback link has expired. Ask the service team for a fresh one.',
        HttpStatus.GONE,
      );
    }
    return row;
  }

  /** The ticket id, or 404 when the caller can't see the ticket. */
  private async visibleTicketId(ticketId: string, user: AuthUser): Promise<string> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, ...visibleTo(user) },
      select: { id: true },
    });
    if (!ticket) throw ticketNotFound();
    return ticket.id;
  }
}
