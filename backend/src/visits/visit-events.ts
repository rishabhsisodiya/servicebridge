import { Injectable } from '@nestjs/common';

/**
 * Emitted after a visit is submitted and its transaction commits. Session 11
 * (ERP write-backs) consumes this to issue the used spares from stock.
 */
export interface VisitSubmittedEvent {
  visitId: string;
  ticketId: string;
  submittedById: string | null;
  submittedAt: Date;
  spareLines: { itemId: string; quantity: number }[];
}

type VisitSubmittedListener = (event: VisitSubmittedEvent) => void | Promise<void>;

/** Tiny in-process bus: no broker needed until write-backs arrive in session 11. */
@Injectable()
export class VisitEvents {
  private readonly submittedListeners: VisitSubmittedListener[] = [];

  onVisitSubmitted(listener: VisitSubmittedListener): void {
    this.submittedListeners.push(listener);
  }

  async emitSubmitted(event: VisitSubmittedEvent): Promise<void> {
    for (const listener of this.submittedListeners) {
      await listener(event);
    }
  }
}
