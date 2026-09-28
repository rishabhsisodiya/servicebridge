import type { Catalog, RecordOp } from "./api";

/**
 * Permission-grid rules, mirroring normalizePermissions on the server: any
 * permission on a record needs that record's read permission. Plain module
 * (no "use client") so it can be unit tested and used anywhere.
 */

const recordOf = (permission: string) => permission.split(".")[0];

/** Turns one permission on or off, keeping the implied read permission consistent. */
export function toggle(selected: ReadonlySet<string>, permission: string, catalog: Catalog) {
  const next = new Set(selected);
  const record = recordOf(permission);
  const read = `${record}.read`;
  const readExists = catalog.records.some((r) => r.key === record && r.ops.includes("read"));

  if (next.has(permission)) {
    next.delete(permission);
    // Without read, nothing else on the record (including its actions) makes sense.
    if (permission === read) {
      for (const p of [...next]) if (recordOf(p) === record) next.delete(p);
    }
  } else {
    next.add(permission);
    if (readExists) next.add(read);
  }
  return next;
}

export const OP_LABELS: Record<RecordOp, string> = {
  read: "Read",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
};

export const ALL_OPS: RecordOp[] = ["read", "create", "edit", "delete"];

/** "Tickets, Customers, Equipment +4" — the records a role can read. */
export function accessSummary(permissions: readonly string[], catalog: Catalog, max = 3): string {
  const readable = catalog.records
    .filter((r) => permissions.includes(`${r.key}.read`))
    .map((r) => r.label);
  if (!readable.length) return "No records";
  const shown = readable.slice(0, max).join(", ");
  return readable.length > max ? `${shown} +${readable.length - max}` : shown;
}
