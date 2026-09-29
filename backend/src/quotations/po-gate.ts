import type { Prisma, QuotationStatus } from '@prisma/client';

/**
 * The PO gate (session 10, approved): when the "require PO before work starts"
 * setting is on, moving a ticket to IN_PROGRESS is blocked while the ticket
 * has a quotation that was sent to the customer without a PO being recorded.
 *
 * SB-H1: revising or cancelling a SENT quotation used to clear the gate — the
 * superseded quotation simply stopped matching `status: 'SENT'`. A quotation
 * that was SENT (sentAt is set — the marker survives revise/cancel) and
 * superseded without a PO still blocks. Its PO obligation is discharged only
 * by a PO on itself or on something that supersedes it: a transitive revision,
 * or — for quotations with no revision chain (cancelled ones) — any quotation
 * created later, which covers the cancel-then-re-quote flow. Without the
 * discharge check, the legitimate revise → send → record-PO flow would block
 * work forever on the superseded quotation.
 *
 * Kept as a plain function (not a provider) so TicketsService can call it
 * without a module cycle: QuotationsModule imports TicketsModule, not the
 * other way round.
 */
export async function findPoBlockingQuotation(
  tx: Prisma.TransactionClient,
  ticketId: string,
): Promise<string | null> {
  const quotations = await tx.quotation.findMany({
    where: { ticketId },
    select: {
      id: true,
      number: true,
      status: true,
      sentAt: true,
      poNumber: true,
      revisesId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const children = new Map<string, typeof quotations>();
  for (const q of quotations) {
    if (!q.revisesId) continue;
    const list = children.get(q.revisesId) ?? [];
    list.push(q);
    children.set(q.revisesId, list);
  }

  /** Whether a PO on this quotation or anything superseding it discharges it. */
  const isDischarged = (root: (typeof quotations)[number]): boolean => {
    const stack = [root];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const q = stack.pop() as (typeof quotations)[number];
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      if (q.poNumber != null) return true;
      for (const child of children.get(q.id) ?? []) stack.push(child);
    }
    return quotations.some(
      (o) => o.id !== root.id && o.poNumber != null && o.createdAt > root.createdAt,
    );
  };

  const BLOCKING: QuotationStatus[] = ['SENT', 'REVISED', 'CANCELLED'];
  for (const q of quotations) {
    if (q.sentAt == null || q.poNumber != null) continue;
    if (!BLOCKING.includes(q.status)) continue;
    if (!isDischarged(q)) return q.number;
  }
  return null;
}
