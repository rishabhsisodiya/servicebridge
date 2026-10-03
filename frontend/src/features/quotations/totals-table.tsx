import { money, totalsCurrency } from "./display";
import type { QuotationTotals } from "./api";

/** The computed breakdown: subtotal → discount → GST on the discounted amount → total. */
export function TotalsTable({ totals }: { totals: QuotationTotals }) {
  const currency = totalsCurrency(totals);
  const rows: Array<{ label: string; value: string; negative?: boolean }> = [
    { label: `Subtotal (${totals.lineCount} ${totals.lineCount === 1 ? "line" : "lines"})`, value: totals.subtotal },
  ];
  if (Number(totals.discount) > 0) {
    rows.push({ label: "Discount", value: totals.discount, negative: true });
    rows.push({ label: "Taxable", value: totals.taxable });
  }
  rows.push({ label: `GST (${totals.gstRatePercent}%)`, value: totals.gst });
  return (
    <dl className="m-0 flex flex-col gap-1.5 p-0 text-[13.5px]">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4">
          <dt className="text-muted">{row.label}</dt>
          <dd className="m-0 font-semibold tabular-nums">
            {row.negative ? "− " : ""}
            {money(row.value, currency)}
          </dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2 text-[15px]">
        <dt className="font-semibold">Total</dt>
        <dd className="m-0 font-bold tabular-nums">{money(totals.total, currency)}</dd>
      </div>
    </dl>
  );
}
