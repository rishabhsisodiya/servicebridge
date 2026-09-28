"use client";

import { ShieldCheck, Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Pager, SearchInput } from "@/components/ui/list-controls";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { ButtonLink } from "@/components/ui/button";
import { AMC_STATUSES, amcKey, type AmcFilters, type AmcPage } from "./api";
import { AmcStatusPill, contractValue, formatDate } from "./display";

const PAGE_SIZE = 25;

const STATUS_FILTER_LABEL: Record<(typeof AMC_STATUSES)[number], string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

/** Every AMC contract: search by number or customer, filter by status. Newest first. */
export function AmcBrowser({ initialSearch = "" }: { initialSearch?: string }) {
  const { can, me } = useSession();
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState<AmcFilters["status"]>("");
  const [page, setPage] = useState(1);

  const allowed = can("amc.read");
  const { data, error, isLoading } = useSWR<AmcPage, ApiError>(
    allowed ? amcKey({ search, status, page }) : null,
    (key: string) => apiFetch<AmcPage>(key),
    { keepPreviousData: true },
  );

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="AMC contracts" />
        <Card>
          <EmptyState
            icon={<Lock className="size-6" />}
            title="You don't have access to this"
            description="Ask your administrator for access to maintenance contracts."
          />
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

  const total = data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="AMC contracts"
        description={
          data
            ? `${total} ${total === 1 ? "contract" : "contracts"}`
            : "Maintenance contracts, planned visits and renewals."
        }
        actions={
          can("amc.edit") && (
            <ButtonLink href="/amc/new" variant="primary">
              New contract
            </ButtonLink>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <SearchInput
            label="Search contracts"
            placeholder="Search by contract number or customer…"
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
                setStatus(e.target.value as AmcFilters["status"]);
                setPage(1);
              }}
              className="sm:w-auto!"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {AMC_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_FILTER_LABEL[s]}
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
            title="Couldn't load contracts"
            description={error.message}
            onRetry={clear}
          />
        )}
        {!isLoading && !error && data && data.data.length === 0 && (
          <EmptyState
            icon={<ShieldCheck className="size-6" aria-hidden />}
            title={filtered ? "No contracts match" : "No contracts yet"}
            description={
              filtered
                ? "Try a different search or clear the filters."
                : "Create the first annual maintenance contract."
            }
          />
        )}
        {!isLoading && !error && data && data.data.length > 0 && (
          <>
            <Table caption="AMC contracts">
              <thead>
                <tr>
                  <Th>Contract</Th>
                  <Th>Customer</Th>
                  <Th>Cover period</Th>
                  <Th>Value</Th>
                  <Th>Status</Th>
                  <Th align="right">Machines</Th>
                  <Th align="right">Visits</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((contract) => (
                  <Tr key={contract.id}>
                    <Td className="font-mono whitespace-nowrap">
                      <Link
                        href={`/amc/${contract.id}`}
                        className="font-semibold text-accent underline-offset-2 hover:underline"
                      >
                        {contract.number}
                      </Link>
                    </Td>
                    <Td>{contract.customer.name}</Td>
                    <Td className="whitespace-nowrap">
                      {formatDate(contract.startsOn)} – {formatDate(contract.endsOn)}
                    </Td>
                    <Td className="whitespace-nowrap">{contractValue(contract.value)}</Td>
                    <Td>
                      <AmcStatusPill status={contract.status} />
                    </Td>
                    <Td align="right" className="whitespace-nowrap">
                      {contract.equipmentCount}
                    </Td>
                    <Td align="right" className="whitespace-nowrap">
                      {contract.plannedVisitCount}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pager
              page={data.page}
              pageSize={25}
              total={data.total}
              noun={data.total === 1 ? "contract" : "contracts"}
              onPage={(next) => setPage(next)}
            />
          </>
        )}
      </Card>
    </>
  );
}
