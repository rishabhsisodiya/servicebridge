import { ShieldCheck, ShieldOff, ShieldAlert } from "lucide-react";
import { StatusPill, Tag } from "@/components/ui/badge";

export type Coverage = "AMC" | "WARRANTY" | "CHARGEABLE";

export const formatDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

export function money(amount: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 ? 2 : 0,
  }).format(amount);
}

/** Coverage with its end date; the shape differs per state so it reads without colour. */
export function CoveragePill({
  coverage,
  until,
  amcExpiring,
}: {
  coverage: Coverage;
  until: string | null;
  amcExpiring: boolean;
}) {
  if (coverage === "AMC") {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <StatusPill tone={amcExpiring ? "warn" : "ok"}>
          {amcExpiring ? "AMC ending soon" : "AMC"}
        </StatusPill>
        <span className="text-xs text-muted">until {formatDate(until)}</span>
      </span>
    );
  }
  if (coverage === "WARRANTY") {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <StatusPill tone="info">Warranty</StatusPill>
        <span className="text-xs text-muted">until {formatDate(until)}</span>
      </span>
    );
  }
  return <StatusPill tone="done">Chargeable</StatusPill>;
}

export const COVERAGE_ICON = {
  AMC: ShieldCheck,
  WARRANTY: ShieldAlert,
  CHARGEABLE: ShieldOff,
} as const;

/** Where a record came from. Demo rows are fictional. */
export function SourceTag({ source }: { source: "DEMO" | "ERP" | "LOCAL" }) {
  if (source === "ERP") return null;
  return (
    <Tag className={source === "DEMO" ? "border-info/40 text-info" : undefined}>
      {source === "DEMO" ? "Demo" : "Local"}
    </Tag>
  );
}
