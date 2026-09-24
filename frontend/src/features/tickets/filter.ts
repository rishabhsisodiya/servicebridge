import type { MockTicket } from "@/mocks/tickets";

export type QuickFilter =
  "open" | "sla-risk" | "unassigned" | "awaiting-verification" | "chargeable" | "closed";

const CLOSED_STAGES = new Set(["CLOSED", "CANCELLED"]);

const QUICK: Record<QuickFilter, (t: MockTicket) => boolean> = {
  open: (t) => !CLOSED_STAGES.has(t.stage),
  "sla-risk": (t) => t.sla.state === "risk" || t.sla.state === "breach",
  unassigned: (t) => !t.engineer && !CLOSED_STAGES.has(t.stage),
  "awaiting-verification": (t) => t.stage === "RESOLVED",
  chargeable: (t) => t.coverage === "Chargeable" && !CLOSED_STAGES.has(t.stage),
  closed: (t) => CLOSED_STAGES.has(t.stage),
};

const PRIORITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

export interface TicketQuery {
  text: string;
  quick: QuickFilter;
  sortByPriority?: "ascending" | "descending";
}

/** Text matches ticket number, customer, site, machine, serial, issue or engineer. */
export function filterTickets(tickets: MockTicket[], query: TicketQuery): MockTicket[] {
  const words = query.text.toLowerCase().split(/\s+/).filter(Boolean);
  const result = tickets.filter((ticket) => {
    if (!QUICK[query.quick](ticket)) return false;
    const haystack = [
      ticket.number,
      ticket.customer,
      ticket.site,
      ticket.machine,
      ticket.serial,
      ticket.issue,
      ticket.engineer ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });

  if (query.sortByPriority) {
    const direction = query.sortByPriority === "ascending" ? 1 : -1;
    result.sort((a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) * direction);
  }
  return result;
}

export function countQuick(tickets: MockTicket[], quick: QuickFilter): number {
  return tickets.filter(QUICK[quick]).length;
}
