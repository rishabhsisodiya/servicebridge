"use client";

import { useState } from "react";
import useSWR from "swr";
import { Field, Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api/client";
import { reportsApi, type ActiveUser } from "./api";

function fullName(user: ActiveUser): string {
  return user.name || user.email;
}

/** Multi-select of active staff with an email address (for report deliveries). */
export function RecipientPicker({
  selected,
  onChange,
  error,
}: {
  selected: string[];
  onChange: (emails: string[]) => void;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  const { data, error: loadError } = useSWR<ActiveUser[], ApiError>(
    "/users?status=ACTIVE",
    () => reportsApi.activeUsers(),
  );

  const users = (data ?? []).filter((u) => u.email);
  const q = query.trim().toLowerCase();
  const matches = q
    ? users.filter((u) => fullName(u).toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    : users.slice(0, 50);

  const toggle = (email: string) =>
    onChange(selected.includes(email) ? selected.filter((e) => e !== email) : [...selected, email]);

  return (
    <Field label="Recipients" error={error} help="Only active staff with an email address. The run uses your ticket scope.">
      {(p) => (
        <div className="flex flex-col gap-2">
          <Input
            {...p}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people…"
          />
          {loadError && <p className="text-sm text-bad">People could not load.</p>}
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-line p-2">
            {matches.length === 0 && (
              <p className="px-2 py-1 text-sm text-muted">No one matches.</p>
            )}
            {matches.map((user) => (
              <label key={user.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={selected.includes(user.email)}
                  onChange={() => toggle(user.email)}
                  className="size-4"
                />
                <span className="font-medium">{fullName(user)}</span>
                <span className="truncate text-muted">{user.email}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <p className="text-xs text-muted">
              {selected.length} recipient{selected.length === 1 ? "" : "s"}: {selected.join(", ")}
            </p>
          )}
        </div>
      )}
    </Field>
  );
}
