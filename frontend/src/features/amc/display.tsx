import { StatusPill, type Tone } from "@/components/ui/badge";
import { formatDate, money } from "@/features/catalog/shared";
import type { AmcStatus, BillingUnit, PlannedVisitStatus } from "./api";

export { formatDate };

const STATUS: Record<AmcStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ACTIVE: { label: "Active", tone: "ok" },
  EXPIRED: { label: "Expired", tone: "warn" },
  CANCELLED: { label: "Cancelled", tone: "done" },
};

export function AmcStatusPill({ status }: { status: AmcStatus }) {
  const { label, tone } = STATUS[status];
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

export const BILLING_UNITS: BillingUnit[] = ["PER_VISIT", "PER_HOUR", "PER_KM", "FIXED"];

export const BILLING_UNIT_LABELS: Record<BillingUnit, string> = {
  PER_VISIT: "Per visit",
  PER_HOUR: "Per hour",
  PER_KM: "Per km",
  FIXED: "Fixed price",
};

const VISIT_STATUS: Record<PlannedVisitStatus, { label: string; tone: Tone }> = {
  PLANNED: { label: "Planned", tone: "info" },
  CREATED: { label: "Ticket created", tone: "prog" },
  SKIPPED: { label: "Skipped", tone: "done" },
};

export function PlannedVisitStatusPill({ status }: { status: PlannedVisitStatus }) {
  const { label, tone } = VISIT_STATUS[status];
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

/** `value` arrives as a Decimal string (or null); this renders it in the company currency. */
export function contractValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const amount = Number(value);
  return Number.isNaN(amount) ? "—" : money(amount);
}

/** ISO datetime → YYYY-MM-DD for <input type="date">. */
export const toDateInput = (iso: string) => iso.slice(0, 10);
