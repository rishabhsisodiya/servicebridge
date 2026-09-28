"use client";

import { Download, Lock, Plus, TicketX } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import useSWR from "swr";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Pager, SearchInput } from "@/components/ui/list-controls";
import { FilterChip, PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { useSession } from "@/lib/auth/session";
import { fetcher, type QuickFilter, type TicketPage } from "./api";
import { QUICK_FILTERS } from "./quick-filters";
import { TicketTable } from "./ticket-table";

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "due", label: "SLA due soonest" },
  { value: "priority", label: "Highest priority first" },
  { value: "oldest", label: "Oldest first" },
] as const;
type Sort = (typeof SORTS)[number]["value"];

export function TicketsBrowser({
  initialQuick,
  initialSearch,
  title = "Tickets",
}: {
  initialQuick: QuickFilter;
  initialSearch: string;
  /** "My tickets" reuses this screen, starting on the Mine filter. */
  title?: string;
}) {
  const { can, me } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [quick, setQuick] = useState<QuickFilter>(initialQuick);
  const [search, setSearch] = useState(initialSearch);
  const [sort, setSort] = useState<Sort>("newest");
  const [page, setPage] = useState(1);
  const [searchKey, setSearchKey] = useState(0);
  // The debounced search box calls back on every settle; refs let it compare without re-subscribing.
  const current = useRef({ quick: initialQuick, search: initialSearch });

  /** Filters live in the address so a view can be shared or reloaded. */
  const apply = useCallback(
    (next: { quick: QuickFilter; search: string }) => {
      current.current = next;
      setQuick(next.quick);
      setSearch(next.search);
      setPage(1);
      const params = new URLSearchParams();
      if (next.quick !== "open") params.set("quick", next.quick);
      if (next.search) params.set("search", next.search);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );
  const onSearch = useCallback(
    (value: string) => {
      if (value !== current.current.search) apply({ ...current.current, search: value });
    },
    [apply],
  );

  const allowed = can("tickets.read");
  const params = new URLSearchParams({ quick, sort, page: String(page), pageSize: "25" });
  if (search) params.set("search", search);
  const { data, error, isLoading, mutate } = useSWR<TicketPage>(
    allowed ? `/tickets?${params}` : null,
    fetcher,
    { keepPreviousData: true },
  );

  if (me && !allowed) {
    return (
      <>
        <PageHeader title={title} />
        <Card>
          <EmptyState icon={<Lock className="size-6" />} title="You don't have access to this" />
        </Card>
      </>
    );
  }

  const filtered = !!search || quick !== "open";
  const clear = () => {
    setSearchKey((k) => k + 1); // remounts the search box empty
    apply({ quick: "open", search: "" });
  };

  return (
    <>
      <PageHeader
        title={title}
        description={
          data
            ? `${data.counts.open} open · ${data.counts["sla-risk"]} at SLA risk`
            : "Every service ticket, with SLA status."
        }
        actions={
          <>
            <Button
              icon={<Download className="size-4" aria-hidden />}
              disabled
              title="Export arrives with reports in session 14"
            >
              Export
            </Button>
            {can("tickets.create") && (
              <ButtonLink
                href="/tickets/new"
                variant="primary"
                icon={<Plus className="size-4" aria-hidden />}
              >
                Log a ticket
              </ButtonLink>
            )}
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-3">
          <SearchInput
            key={searchKey}
            label="Search tickets"
            placeholder="Ticket no., customer, serial, engineer or problem"
            onChange={onSearch}
            initial={searchKey === 0 ? initialSearch : ""}
          />
          <Select
            aria-label="Sort"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as Sort);
              setPage(1);
            }}
            className="min-h-9 sm:w-auto!"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
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
              onClick={() => apply({ quick: filter.key, search })}
              count={data?.counts[filter.key]}
            >
              {filter.label}
            </FilterChip>
          ))}
        </div>

        <p className="sr-only" aria-live="polite">
          {data ? `${data.meta.total} ${data.meta.total === 1 ? "ticket" : "tickets"} found` : ""}
        </p>

        {isLoading && !data && <TableSkeleton label="Loading tickets" />}
        {error && !data && (
          <ErrorState title="Couldn't load tickets" onRetry={() => void mutate()} />
        )}
        {data && data.data.length === 0 && (
          <EmptyState
            icon={<TicketX className="size-6" />}
            title={filtered ? "No tickets match" : "No open tickets"}
            description={
              filtered
                ? "Try fewer words, or switch the quick filter back to Open."
                : "New tickets appear here as soon as they're logged."
            }
            action={
              filtered ? (
                <Button size="sm" onClick={clear}>
                  Clear search and filters
                </Button>
              ) : undefined
            }
          />
        )}
        {data && data.data.length > 0 && <TicketTable tickets={data.data} caption="Tickets" />}
        {data && data.meta.total > 0 && <Pager {...data.meta} noun="tickets" onPage={setPage} />}
      </Card>
    </>
  );
}
