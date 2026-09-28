"use client";

import { useState } from "react";
import useSWR from "swr";
import { SearchInput } from "@/components/ui/list-controls";
import { apiFetch } from "@/lib/api/client";

export interface CustomerOption {
  id: string;
  name: string;
  territory: string | null;
  machineCount: number;
}

/** Search-and-pick one customer (same pattern as the log-a-ticket form). */
export function CustomerPicker({
  label = "Customer",
  required = true,
  error,
  onPick,
}: {
  label?: string;
  required?: boolean;
  error?: string;
  onPick: (customer: CustomerOption) => void;
}) {
  const [search, setSearch] = useState("");
  const results = useSWR<{ data: CustomerOption[] }>(
    search.length >= 2 ? `/customers?search=${encodeURIComponent(search)}&pageSize=8` : null,
    (key: string) => apiFetch<{ data: CustomerOption[] }>(key),
    { keepPreviousData: true },
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold">
        {label}{" "}
        {required && (
          <span className="text-bad" aria-hidden>
            *
          </span>
        )}
      </span>
      <SearchInput
        label={`Find the ${label.toLowerCase()}`}
        placeholder="Customer name, GSTIN or phone"
        onChange={setSearch}
      />
      {error && <p className="text-xs font-semibold text-bad">{error}</p>}
      {search.length >= 2 && (
        <ul
          aria-label="Matching customers"
          className="m-0 list-none overflow-hidden rounded-lg border border-line p-0"
        >
          {results.data?.data.length === 0 && (
            <li className="px-3.5 py-2.5 text-[13px] text-muted">No customers match.</li>
          )}
          {results.error && (
            <li className="px-3.5 py-2.5 text-[13px] text-bad">
              Couldn&apos;t search customers.
            </li>
          )}
          {results.data?.data.map((c) => (
            <li key={c.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => onPick(c)}
                className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-2 focus-visible:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{c.name}</span>
                  {c.territory && <span className="block text-xs text-muted">{c.territory}</span>}
                </span>
                <span className="text-xs text-muted">
                  {c.machineCount} {c.machineCount === 1 ? "machine" : "machines"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
