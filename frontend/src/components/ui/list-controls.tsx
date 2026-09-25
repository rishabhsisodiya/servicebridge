"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "./button";

/** Search box that reports its value 300 ms after typing stops. */
export function SearchInput({
  label,
  placeholder,
  onChange,
  initial = "",
}: {
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
  initial?: string;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const timer = setTimeout(() => onChange(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value, onChange]);

  return (
    <div className="relative min-w-56 flex-1">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted"
        aria-hidden
      />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        className="min-h-9 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-8 placeholder:text-faint focus:border-accent focus:outline-2 focus:outline-offset-0 focus:outline-accent/50 max-sm:text-base"
      />
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  noun,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  return (
    <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[12.5px] text-muted">
      {from}–{Math.min(page * pageSize, total)} of {total.toLocaleString()} {noun}
      {pages > 1 && (
        <span className="ml-auto flex gap-2">
          <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </Button>
          <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            Next
          </Button>
        </span>
      )}
    </div>
  );
}
