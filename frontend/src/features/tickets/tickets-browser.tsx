"use client";

import { ArrowUpDown, Search, TicketX } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterChip } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/states";
import type { SortDirection } from "@/components/ui/table";
import { MOCK_TICKETS } from "@/mocks/tickets";
import { countQuick, filterTickets, type QuickFilter } from "./filter";
import { TicketTable } from "./ticket-table";

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "sla-risk", label: "SLA at risk" },
  { key: "unassigned", label: "Unassigned" },
  { key: "awaiting-verification", label: "Awaiting verification" },
  { key: "chargeable", label: "Chargeable" },
  { key: "closed", label: "Closed" },
];

export function TicketsBrowser() {
  const [text, setText] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("open");
  const [sortByPriority, setSortByPriority] = useState<SortDirection | undefined>();
  const tickets = useMemo(
    () => filterTickets(MOCK_TICKETS, { text, quick, sortByPriority }),
    [text, quick, sortByPriority],
  );

  const clear = () => {
    setText("");
    setQuick("open");
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-3">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <label htmlFor="ticket-search" className="sr-only">
            Search tickets
          </label>
          <input
            id="ticket-search"
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Ticket no., customer, serial or engineer"
            className="min-h-9 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-8 placeholder:text-faint focus:border-accent focus:outline-2 focus:outline-offset-0 focus:outline-accent/50 max-sm:text-base"
          />
        </div>
        <Button
          size="sm"
          aria-pressed={sortByPriority !== undefined}
          icon={<ArrowUpDown className="size-3.5" aria-hidden />}
          onClick={() =>
            setSortByPriority((d) =>
              d === "ascending" ? "descending" : d === "descending" ? undefined : "ascending",
            )
          }
        >
          {sortByPriority === "ascending"
            ? "Highest priority first"
            : sortByPriority === "descending"
              ? "Lowest priority first"
              : "Sort by priority"}
        </Button>
      </div>

      <div
        role="group"
        aria-label="Quick filters"
        className="flex flex-wrap gap-1.5 border-b border-line px-3.5 py-2.5"
      >
        {QUICK_FILTERS.map((filter) => (
          <FilterChip
            key={filter.key}
            pressed={quick === filter.key}
            onClick={() => setQuick(filter.key)}
            count={countQuick(MOCK_TICKETS, filter.key)}
          >
            {filter.label}
          </FilterChip>
        ))}
      </div>

      <p className="sr-only" aria-live="polite">
        {tickets.length} {tickets.length === 1 ? "ticket" : "tickets"} shown
      </p>

      {tickets.length > 0 ? (
        <TicketTable tickets={tickets} caption="Tickets" />
      ) : (
        <EmptyState
          icon={<TicketX className="size-6" />}
          title="No tickets match"
          description="Try fewer words, or switch the quick filter back to Open."
          action={
            <Button size="sm" onClick={clear}>
              Clear search and filters
            </Button>
          }
        />
      )}

      <div className="flex items-center gap-2 border-t border-line px-3.5 py-2.5 text-[12.5px] text-muted">
        Showing {tickets.length} of {MOCK_TICKETS.length} sample tickets
      </div>
    </Card>
  );
}
