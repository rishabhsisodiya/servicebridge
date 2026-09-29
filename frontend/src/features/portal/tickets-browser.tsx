"use client";

import { TicketX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Pager, SearchInput } from "@/components/ui/list-controls";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDate } from "@/features/catalog/shared";
import { ApiError } from "@/lib/api/client";
import { usePortalTicketList } from "./api";
import { PortalPriorityPill, PortalStagePill } from "./display";

const PAGE_SIZE = 20;

/**
 * The customer's tickets, newest first. The contract's list endpoint takes no
 * search parameter, so the search box filters the loaded page client-side.
 */
export function PortalTicketsBrowser() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const { data, error, isLoading, mutate } = usePortalTicketList(page);

  const items = useMemo(() => {
    const query = search.trim().toLowerCase();
    const all = data?.items ?? [];
    if (!query) return all;
    return all.filter(
      (item) =>
        item.number.toLowerCase().includes(query) ||
        item.title.toLowerCase().includes(query) ||
        item.stage.toLowerCase().includes(query),
    );
  }, [data, search]);

  const total = search.trim() ? items.length : (data?.total ?? 0);

  return (
    <>
      <PageHeader
        title="My tickets"
        description={
          data ? `${data.total} ${data.total === 1 ? "ticket" : "tickets"}` : "Your service requests."
        }
        actions={
          <Link
            href="/portal/tickets/new"
            className="inline-flex min-h-9 items-center justify-center rounded-lg bg-accent-strong px-4 text-sm font-semibold text-on-accent-strong no-underline hover:brightness-95 max-sm:flex-1"
          >
            Raise a ticket
          </Link>
        }
      />
      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <SearchInput
            label="Search tickets"
            placeholder="Search by ticket number or title…"
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />
        </div>
        {isLoading ? (
          <TableSkeleton rows={6} label="Loading your tickets" />
        ) : error || !data ? (
          <ErrorState
            title="Couldn't load your tickets"
            description={error instanceof ApiError ? error.message : undefined}
            onRetry={() => void mutate()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<TicketX className="size-6" aria-hidden />}
            title={search.trim() ? "No tickets match your search" : "No tickets yet"}
            description={
              search.trim()
                ? "Try a different ticket number or title."
                : "Raise your first ticket and track its progress here."
            }
          />
        ) : (
          <>
            <Table caption="Your service tickets">
              <thead>
                <Tr>
                  <Th>Ticket</Th>
                  <Th>Stage</Th>
                  <Th>Priority</Th>
                  <Th>SLA due</Th>
                  <Th>Raised</Th>
                </Tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <Tr key={item.number}>
                    <Td>
                      <Link
                        href={`/portal/tickets/${encodeURIComponent(item.number)}`}
                        className="font-semibold"
                      >
                        {item.number}
                      </Link>
                      <div className="mt-0.5 max-w-64 truncate text-muted">{item.title}</div>
                    </Td>
                    <Td>
                      <PortalStagePill stage={item.stage} />
                    </Td>
                    <Td>
                      <PortalPriorityPill priority={item.priority} />
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(item.slaDueAt)}</Td>
                    <Td className="whitespace-nowrap">{formatDate(item.createdAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pager
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              noun="tickets"
              onPage={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
