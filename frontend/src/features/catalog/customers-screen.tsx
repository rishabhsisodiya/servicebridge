"use client";

import { Building2, Lock } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import useSWR from "swr";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Pager, SearchInput } from "@/components/ui/list-controls";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Sub, Table, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { SourceTag } from "./shared";

interface CustomerRow {
  id: string;
  name: string;
  source: "DEMO" | "ERP" | "LOCAL";
  erpName: string | null;
  customerGroup: string | null;
  territory: string | null;
  taxId: string | null;
  mobile: string | null;
  siteCount: number;
  machineCount: number;
  primaryContact: { name: string; mobile: string | null } | null;
}

interface CustomersPage {
  data: CustomerRow[];
  meta: { page: number; pageSize: number; total: number };
  territories: string[];
}

export function CustomersScreen() {
  const { can, me } = useSession();
  const [search, setSearch] = useState("");
  const [territory, setTerritory] = useState("");
  const [page, setPage] = useState(1);
  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);
  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (search) params.set("search", search);
  if (territory) params.set("territory", territory);
  const allowed = can("customers.view");
  const { data, error, isLoading, mutate } = useSWR<CustomersPage>(
    allowed ? `/customers?${params}` : null,
    (k: string) => apiFetch<CustomersPage>(k),
    {
      keepPreviousData: true,
    },
  );

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="Customers" />
        <Card>
          <EmptyState icon={<Lock className="size-6" />} title="You don't have access to this" />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Customers"
        description={
          data
            ? `${data.meta.total.toLocaleString()} customers`
            : "Customers, their sites and contacts."
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-3">
          <SearchInput
            label="Search customers"
            placeholder="Name, GSTIN, phone or email"
            onChange={onSearch}
          />
          {!!data?.territories.length && (
            <Select
              aria-label="Territory"
              value={territory}
              onChange={(e) => {
                setTerritory(e.target.value);
                setPage(1);
              }}
              className="min-h-9 sm:w-auto!"
            >
              <option value="">All territories</option>
              {data.territories.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          )}
        </div>
        {isLoading && !data && <TableSkeleton label="Loading customers" />}
        {error && !data && (
          <ErrorState title="Couldn't load customers" onRetry={() => void mutate()} />
        )}
        {data?.data.length === 0 && (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title={search || territory ? "No customers match" : "No customers yet"}
            description={
              search || territory
                ? "Try another name, or clear the territory filter."
                : "Customers arrive from your ERP (Settings → ERP connections) or from the demo data (Settings → Company & demo data)."
            }
          />
        )}
        {data && data.data.length > 0 && (
          <Table caption="Customers">
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Territory</Th>
                <Th>Contact</Th>
                <Th align="right">Sites</Th>
                <Th align="right">Machines</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((c) => (
                <Tr key={c.id} className="hover:bg-surface-2">
                  <Td className="min-w-64">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/customers/${c.id}`}
                        className="font-semibold text-text underline-offset-2 hover:underline"
                      >
                        {c.name}
                      </Link>
                      <SourceTag source={c.source} />
                    </span>
                    <Sub>{[c.customerGroup, c.taxId].filter(Boolean).join(" · ") || "—"}</Sub>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {c.territory ?? <span className="text-muted">—</span>}
                  </Td>
                  <Td className="min-w-40">
                    {c.primaryContact ? (
                      <>
                        {c.primaryContact.name}
                        {c.primaryContact.mobile && <Sub>{c.primaryContact.mobile}</Sub>}
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td align="right">{c.siteCount}</Td>
                  <Td align="right">{c.machineCount}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {data && data.meta.total > 0 && <Pager {...data.meta} noun="customers" onPage={setPage} />}
      </Card>
    </>
  );
}
