import type { Prisma } from '@prisma/client';

/**
 * The PO gate (session 10, approved): when the "require PO before work starts"
 * setting is on, moving a ticket to IN_PROGRESS is blocked while a SENT
 * quotation on that ticket has no PO recorded.
 *
 * Kept as a plain function (not a provider) so TicketsService can call it
 * without a module cycle: QuotationsModule imports TicketsModule, not the
 * other way round.
 */
export async function findPoBlockingQuotation(
  tx: Prisma.TransactionClient,
  ticketId: string,
): Promise<string | null> {
  const blocking = await tx.quotation.findFirst({
    where: { ticketId, status: 'SENT', poNumber: null },
    select: { number: true },
    orderBy: { sentAt: 'asc' },
  });
  return blocking?.number ?? null;
}
