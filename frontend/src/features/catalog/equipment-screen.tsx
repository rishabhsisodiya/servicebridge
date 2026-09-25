"use client";

import { Lock, Wrench } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import useSWR from "swr";
import { Card } from "@/components/ui/card";
import { Pager, SearchInput } from "@/components/ui/list-controls";
import { FilterChip, PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Sub, Table, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { type Coverage, CoveragePill, SourceTag } from "./shared";

type CoverageFilter = "" | "amc" | "amc_expiring" | "warranty" | "chargeable";

interface MachineRow {
  id: string;
  serialNo: string;
  itemCode: string | null;
  itemName: string | null;
  source: "DEMO" | "ERP" | "LOCAL";
  customer: { id: string; name: string; territory: string | null } | null;
  customerErpName: string | null;
  coverage: Coverage;
  until: string | null;
  amcExpiring: boolean;
}

interface Page {
  data: MachineRow[];
  meta: { page: number; pageSize: number; total: number };
}

const FILTERS: { key: CoverageFilter; label: string }[] = [
  { key: "", label: "All" },
  { key: "amc", label: "Under AMC" },
  { key: "amc_expiring", label: "AMC ending in 60 days" },
  { key: "warranty", label: "In warranty" },
  { key: "chargeable", label: "Chargeable" },
];

export function EquipmentScreen({ initialSearch = "" }: { initialSearch?: string }) {
  const { can, me } = useSession();
  const [search, setSearch] = useState(initialSearch);
  const [coverage, setCoverage] = useState<CoverageFilter>("");
  const [page, setPage] = useState(1);
  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);
  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (search) params.set("search", search);
  if (coverage) params.set("coverage", coverage);
  const allowed = can("equipment.view");
  const { data, error, isLoading, mutate } = useSWR<Page>(
    allowed ? `/equipment?${params}` : null,
    (k: string) => apiFetch<Page>(k),
    {
      keepPreviousData: true,
    },
  );

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="Equipment" />
        <Card>
          <EmptyState icon={<Lock className="size-6" />} title="You don't have access to this" />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Equipment"
        description="Machines at customer sites, with warranty and AMC coverage. Coverage decides who pays for a visit."
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-3">
          <SearchInput
            label="Search machines"
            placeholder="Serial no., model or customer"
            onChange={onSearch}
            initial={initialSearch}
          />
        </div>
        <div
          role="group"
          aria-label="Coverage"
          className="flex flex-wrap gap-1.5 border-b border-line px-3.5 py-2.5"
        >
          {FILTERS.map((f) => (
            <FilterChip
              key={f.key || "all"}
              pressed={coverage === f.key}
              onClick={() => {
                setCoverage(f.key);
                setPage(1);
              }}
            >
              {f.label}
            </FilterChip>
          ))}
        </div>
        {isLoading && !data && <TableSkeleton label="Loading machines" />}
        {error && !data && (
          <ErrorState title="Couldn't load machines" onRetry={() => void mutate()} />
        )}
        {data?.data.length === 0 && (
          <EmptyState
            icon={<Wrench className="size-6" />}
            title={search || coverage ? "No machines match" : "No machines yet"}
            description={
              search || coverage
                ? "Try another search or coverage filter."
                : "Machines come from serial numbers in your ERP, or from the demo data."
            }
          />
        )}
        {data && data.data.length > 0 && (
          <Table caption="Machines">
            <thead>
              <tr>
                <Th>Serial no.</Th>
                <Th>Model</Th>
                <Th>Customer</Th>
                <Th>Coverage</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((m) => (
                <Tr key={m.id}>
                  <Td className="min-w-44">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold">{m.serialNo}</span>
                      <SourceTag source={m.source} />
                    </span>
                  </Td>
                  <Td className="min-w-48">
                    {m.itemName ?? "—"}
                    {m.itemCode && <Sub>{m.itemCode}</Sub>}
                  </Td>
                  <Td className="min-w-48">
                    {m.customer ? (
                      <>
                        <Link
                          href={`/customers/${m.customer.id}`}
                          className="text-text underline-offset-2 hover:underline"
                        >
                          {m.customer.name}
                        </Link>
                        {m.customer.territory && <Sub>{m.customer.territory}</Sub>}
                      </>
                    ) : (
                      <span className="text-muted">
                        {m.customerErpName
                          ? `${m.customerErpName} (not synced yet)`
                          : "Not assigned"}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <CoveragePill
                      coverage={m.coverage}
                      until={m.until}
                      amcExpiring={m.amcExpiring}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {data && data.meta.total > 0 && <Pager {...data.meta} noun="machines" onPage={setPage} />}
      </Card>
    </>
  );
}
