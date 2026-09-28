import { StatusPill, type Tone } from "@/components/ui/badge";
import { formatDate, money as baseMoney } from "@/features/catalog/shared";
import type { QuotationStatus, QuotationTotals } from "./api";

export { formatDate };

const STATUS_META: Record<QuotationStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "prog" },
  SENT: { label: "Sent", tone: "info" },
  PO_RECEIVED: { label: "PO received", tone: "ok" },
  EXPIRED: { label: "Expired", tone: "warn" },
  REVISED: { label: "Revised", tone: "done" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

/** Status with its own marker shape as well as colour, never colour alone. */
export function QuotationStatusPill({
  status,
  plain,
}: {
  status: QuotationStatus;
  plain?: boolean;
}) {
  const meta = STATUS_META[status];
  return (
    <StatusPill tone={meta.tone} plain={plain}>
      {meta.label}
    </StatusPill>
  );
}

export const STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PO_RECEIVED: "PO received",
  EXPIRED: "Expired",
  REVISED: "Revised",
  CANCELLED: "Cancelled",
};

/** The API returns totals as two-decimal strings; format with the company currency. */
export function money(amount: string | number, currency = "INR") {
  return baseMoney(Number(amount), currency);
}

export function totalsCurrency(totals: QuotationTotals) {
  return totals.currency || "INR";
}
