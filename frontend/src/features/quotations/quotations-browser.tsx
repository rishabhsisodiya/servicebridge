"use client";

import { FileSignature, Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Pager, SearchInput } from "@/components/ui/list-controls";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { listQuotations, QUOTATION_STATUSES, type QuotationPage } from "./api";
import { formatDate, money, QuotationStatusPill, STATUS_LABELS, totalsCurrency } from "./display";

const PAGE_SIZE = 25;

/**
 * Every quotation the viewer may see: search by number or customer, filter by
 * status. Newest first.
 */
export function QuotationsBrowser({ initialSearch = "" }: { initialSearch?: string }) {
  const { can, me } = useSession();
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState<(typeof QUOTATION_STATUSES)[number] | "">("");
  const [page, setPage] = useState(1);

  const allowed = can("quotations.read");
  const { data, error, isLoading } = useSWR<QuotationPage, ApiError>(
    allowed ? ["quotations", search, status, page] : null,
    () =>
      listQuotations({
        search: search || undefined,
        status: status || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    { keepPreviousData: true },
  );

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="Quotations" />
        <Card>
          <EmptyState icon={<Lock className="size-6" />} title="You don't have access to this" />
        </Card>
      </>
    );
  }

  const filtered = !!search || !!status;
  const clear = () => {
    setSearch("");
    setStatus("");
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Quotes for chargeable work: drafts, sent offers and their purchase orders."
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <SearchInput
            label="Search quotations"
            placeholder="Search by quotation number or customer…"
            initial={initialSearch}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />
          <label className="flex items-center gap-2 text-[13px]">
            <span className="sr-only">Status</span>
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as typeof status);
                setPage(1);
              }}
              className="sm:w-auto!"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {QUOTATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </label>
          {filtered && (
            <button
              type="button"
              onClick={clear}
              className="text-[13px] font-semibold text-accent underline underline-offset-2"
            >
              Clear
            </button>
          )}
        </div>

        {isLoading && <TableSkeleton rows={8} />}
        {error && (
          <ErrorState
            title="Couldn't load quotations"
            description={error.message}
            onRetry={clear}
          />
        )}
        {!isLoading && !error && data && data.data.length === 0 && (
          <EmptyState
            icon={<FileSignature className="size-6" aria-hidden />}
            title={filtered ? "No quotations match" : "No quotations yet"}
            description={
              filtered
                ? "Try a different number, customer or status."
                : "Quotations are created from a chargeable ticket."
            }
          />
        )}
        {!isLoading && !error && data && data.data.length > 0 && (
          <div className="relative overflow-x-auto">
            <Table>
              <thead>
                <Tr>
                  <Th>Quotation</Th>
                  <Th>Status</Th>
                  <Th align="right">Total</Th>
                  <Th>Valid until</Th>
                </Tr>
              </thead>
              <tbody>
                {data.data.map((q) => (
                  <Tr key={q.id}>
                    <Td>
                      <Link
                        href={`/quotations/${q.id}`}
                        className="font-mono font-semibold underline-offset-2 hover:underline"
                      >
                        {q.number}
                      </Link>
                      {q.poNumber && (
                        <span className="block text-xs text-muted">PO {q.poNumber}</span>
                      )}
                    </Td>
                    <Td>
                      <QuotationStatusPill status={q.status} />
                    </Td>
                    <Td align="right" className="font-semibold tabular-nums">
                      {money(q.totals.total, totalsCurrency(q.totals))}
                    </Td>
                    <Td className="text-muted">{formatDate(q.validUntil)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        {data && data.total > 0 && (
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} noun="quotations" onPage={setPage} />
        )}
      </Card>
    </>
  );
}
