"use client";

import { Boxes, Lock } from "lucide-react";
import { useCallback, useState } from "react";
import useSWR from "swr";
import { StatusPill } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Pager, SearchInput } from "@/components/ui/list-controls";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Sub, Table, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { money, SourceTag } from "./shared";

interface ItemRow {
  id: string;
  itemCode: string;
  name: string;
  itemGroup: string | null;
  uom: string | null;
  source: "DEMO" | "ERP" | "LOCAL";
  stock: { warehouse: string; actualQty: number; projectedQty: number }[];
  totalQty: number;
  prices: { priceList: string; rate: number; currency: string }[];
}

interface Page {
  data: ItemRow[];
  meta: { page: number; pageSize: number; total: number };
  groups: string[];
  priceLists: string[];
}

export function ItemsScreen() {
  const { can, me } = useSession();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [page, setPage] = useState(1);
  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);
  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (search) params.set("search", search);
  if (group) params.set("group", group);
  const allowed = can("items.read");
  const { data, error, isLoading, mutate } = useSWR<Page>(
    allowed ? `/items?${params}` : null,
    (k: string) => apiFetch<Page>(k),
    {
      keepPreviousData: true,
    },
  );

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="Spares & items" />
        <Card>
          <EmptyState icon={<Lock className="size-6" />} title="You don't have access to this" />
        </Card>
      </>
    );
  }

  const priceLists = data?.priceLists ?? [];

  return (
    <>
      <PageHeader
        title="Spares & items"
        description="Stock and selling prices from your ERP (or the demo data). Read-only here: change them in ERPNext."
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-3">
          <SearchInput label="Search items" placeholder="Item code or name" onChange={onSearch} />
          {!!data?.groups.length && (
            <Select
              aria-label="Item group"
              value={group}
              onChange={(e) => {
                setGroup(e.target.value);
                setPage(1);
              }}
              className="min-h-9 sm:w-auto!"
            >
              <option value="">All groups</option>
              {data.groups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          )}
        </div>
        {isLoading && !data && <TableSkeleton label="Loading items" />}
        {error && !data && <ErrorState title="Couldn't load items" onRetry={() => void mutate()} />}
        {data?.data.length === 0 && (
          <EmptyState
            icon={<Boxes className="size-6" />}
            title={search || group ? "No items match" : "No items yet"}
            description={
              search || group
                ? "Try another code or name."
                : "Items come from your ERP, or from the demo data."
            }
          />
        )}
        {data && data.data.length > 0 && (
          <Table caption="Spares and items">
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Stock</Th>
                {priceLists.map((list) => (
                  <Th key={list} align="right">
                    {list}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map((item) => (
                <Tr key={item.id}>
                  <Td className="min-w-64">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold">{item.itemCode}</span>
                      <SourceTag source={item.source} />
                    </span>
                    <Sub>
                      {item.name}
                      {item.itemGroup ? ` · ${item.itemGroup}` : ""}
                    </Sub>
                  </Td>
                  <Td className="min-w-48">
                    {item.stock.length === 0 ? (
                      <span className="text-muted">Not stocked</span>
                    ) : item.totalQty <= 0 ? (
                      <StatusPill tone="bad">Out of stock</StatusPill>
                    ) : (
                      <span className="font-semibold">
                        {item.totalQty.toLocaleString()} {item.uom ?? ""}
                      </span>
                    )}
                    {item.stock.length > 0 && (
                      <Sub>
                        {item.stock.map((s) => `${s.warehouse}: ${s.actualQty}`).join(" · ")}
                      </Sub>
                    )}
                  </Td>
                  {priceLists.map((list) => {
                    const price = item.prices.find((p) => p.priceList === list);
                    return (
                      <Td key={list} align="right" className="whitespace-nowrap">
                        {price ? (
                          money(price.rate, price.currency)
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {data && data.meta.total > 0 && <Pager {...data.meta} noun="items" onPage={setPage} />}
      </Card>
    </>
  );
}
