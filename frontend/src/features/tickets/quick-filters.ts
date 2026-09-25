import type { QuickFilter } from "./api";

// Plain module (no "use client") so server pages can call isQuickFilter.

export const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "mine", label: "Mine" },
  { key: "sla-risk", label: "SLA at risk" },
  { key: "unassigned", label: "Unassigned" },
  { key: "awaiting-verification", label: "Awaiting verification" },
  { key: "chargeable", label: "Chargeable" },
  { key: "closed", label: "Closed" },
];

export function isQuickFilter(value: unknown): value is QuickFilter {
  return QUICK_FILTERS.some((f) => f.key === value);
}
