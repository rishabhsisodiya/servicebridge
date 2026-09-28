import { Injectable } from '@nestjs/common';

/**
 * Emitted after a quotation is sent and its transaction commits. Session 11
 * (ERP write-backs) consumes this to create the draft sales order / invoice.
 */
export interface QuotationSentEvent {
  quotationId: string;
  ticketId: string;
  number: string;
  sentById: string;
  sentAt: Date;
}

/** Emitted after a PO is recorded: the quotation is superseded, work may start. */
export interface PoReceivedEvent {
  quotationId: string;
  ticketId: string;
  number: string;
  poNumber: string;
  recordedById: string;
  receivedAt: Date;
}

type QuotationSentListener = (event: QuotationSentEvent) => void | Promise<void>;
type PoReceivedListener = (event: PoReceivedEvent) => void | Promise<void>;

/** Tiny in-process bus: no broker needed until write-backs arrive in session 11. */
@Injectable()
export class QuotationEvents {
  private readonly sentListeners: QuotationSentListener[] = [];
  private readonly poReceivedListeners: PoReceivedListener[] = [];

  onQuotationSent(listener: QuotationSentListener): void {
    this.sentListeners.push(listener);
  }

  onPoReceived(listener: PoReceivedListener): void {
    this.poReceivedListeners.push(listener);
  }

  async emitSent(event: QuotationSentEvent): Promise<void> {
    for (const listener of this.sentListeners) {
      await listener(event);
    }
  }

  async emitPoReceived(event: PoReceivedEvent): Promise<void> {
    for (const listener of this.poReceivedListeners) {
      await listener(event);
    }
  }
}
