"use client";

import { ArrowLeft, Printer } from "lucide-react";
import { useEffect } from "react";
import useSWR from "swr";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError } from "@/lib/api/client";
import { getPrintView, type PrintQuotation } from "./api";
import { formatDate, money, QuotationStatusPill, STATUS_LABELS, totalsCurrency } from "./display";

/**
 * The paper handover for a quotation: company header, lines, computed totals
 * and the valid-until date. Prints cleanly in either theme — the print
 * stylesheet below strips the app chrome and forces black on white.
 */
export function PrintView({ quotationId }: { quotationId: string }) {
  const { data, error, isLoading, mutate } = useSWR<PrintQuotation, ApiError>(
    `/quotations/${quotationId}/print`,
    () => getPrintView(quotationId),
  );

  useEffect(() => {
    document.body.classList.add("print-quotation");
    return () => document.body.classList.remove("print-quotation");
  }, []);

  if (isLoading) {
    return (
      <div className="no-print">
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="no-print">
        <ErrorState
          title={error?.status === 404 ? "Quotation not found" : "Couldn't load this quotation"}
          description={error?.message}
          onRetry={error?.status === 404 ? undefined : () => void mutate()}
        />
      </div>
    );
  }

  const { company, ticket, quotation } = data;
  const currency = totalsCurrency(quotation.totals);

  return (
    <>
      <style>{`
        @media print {
          body.print-quotation #app-nav,
          body.print-quotation header:not(.print-doc-header),
          body.print-quotation [role="note"],
          body.print-quotation .no-print { display: none !important; }
          body.print-quotation main#main { max-width: none; margin: 0; padding: 0; }
          body.print-quotation .print-doc,
          body.print-quotation .print-doc * {
            color: #000 !important;
            background: transparent !important;
            border-color: #bbb !important;
            box-shadow: none !important;
          }
          body.print-quotation .print-doc { font-size: 12px; }
        }
      `}</style>

      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <ButtonLink href={`/quotations/${quotationId}`} variant="secondary" icon={<ArrowLeft className="size-4" aria-hidden />}>
          Back to quotation
        </ButtonLink>
        <Button
          variant="primary"
          icon={<Printer className="size-4" aria-hidden />}
          onClick={() => window.print()}
          className="sm:ml-auto"
        >
          Print / save PDF
        </Button>
      </div>

      <article className="print-doc mx-auto max-w-3xl rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-10">
        <header className="print-doc-header flex flex-wrap items-start justify-between gap-4 border-b-2 border-line-strong pb-5">
          <div>
            <p className="text-xs font-semibold tracking-widest text-muted uppercase">Quotation</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">{quotation.number}</h1>
            <p className="mt-1 text-[13px] text-muted">
              {company.name} · {STATUS_LABELS[quotation.status]}
            </p>
          </div>
          <div className="text-right text-[13px]">
            <p>
              <span className="text-muted">Issued </span>
              <span className="font-semibold">{formatDate(quotation.sentAt ?? quotation.createdAt)}</span>
            </p>
            <p>
              <span className="text-muted">Valid until </span>
              <span className="font-semibold">{formatDate(quotation.validUntil)}</span>
            </p>
            <p className="mt-1">
              <QuotationStatusPill status={quotation.status} plain />
            </p>
          </div>
        </header>

        <section aria-label="Ticket and customer" className="grid grid-cols-1 gap-4 py-5 sm:grid-cols-2">
          <div>
            <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">Prepared for</h2>
            <p className="mt-1 font-semibold">{ticket.customer?.name ?? "—"}</p>
            {ticket.site && (
              <p className="text-[13px] text-muted">
                {ticket.site.title}
                {[ticket.site.line1, ticket.site.line2].filter(Boolean).join(", ") &&
                  ` · ${[ticket.site.line1, ticket.site.line2].filter(Boolean).join(", ")}`}
              </p>
            )}
            {ticket.customer?.mobile && (
              <p className="text-[13px] text-muted">{ticket.customer.mobile}</p>
            )}
            {ticket.customer?.email && (
              <p className="text-[13px] text-muted">{ticket.customer.email}</p>
            )}
          </div>
          <div className="sm:text-right">
            <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">Reference</h2>
            <p className="mt-1 font-mono font-semibold">{ticket.number}</p>
            <p className="text-[13px] text-muted">{ticket.title}</p>
          </div>
        </section>

        <section aria-label="Line items">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="border-y border-line-strong text-left text-xs tracking-wide text-muted uppercase">
                <th scope="col" className="py-2 pr-2 font-semibold">#</th>
                <th scope="col" className="py-2 pr-2 font-semibold">Item</th>
                <th scope="col" className="py-2 pr-2 text-right font-semibold">Qty</th>
                <th scope="col" className="py-2 pr-2 text-right font-semibold">Rate</th>
                <th scope="col" className="py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quotation.lines.map((line, index) => (
                <tr key={line.id} className="border-b border-line align-top">
                  <td className="py-2 pr-2 text-muted tabular-nums">{index + 1}</td>
                  <td className="py-2 pr-2">
                    <span className="block font-semibold">{line.item.name}</span>
                    <span className="block text-xs text-muted">
                      {line.item.itemCode}
                      {line.item.uom ? ` · ${line.item.uom}` : ""}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{Number(line.quantity)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {money(line.rate, currency)}
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {money(Number(line.quantity) * Number(line.rate), currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-label="Totals" className="flex justify-end py-5">
          <dl className="m-0 w-full max-w-xs p-0 text-[13.5px]">
            <div className="flex justify-between gap-4 py-0.5">
              <dt className="text-muted">Subtotal</dt>
              <dd className="m-0 font-semibold tabular-nums">{money(quotation.totals.subtotal, currency)}</dd>
            </div>
            {Number(quotation.totals.discount) > 0 && (
              <>
                <div className="flex justify-between gap-4 py-0.5">
                  <dt className="text-muted">Discount</dt>
                  <dd className="m-0 font-semibold tabular-nums">
                    − {money(quotation.totals.discount, currency)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 py-0.5">
                  <dt className="text-muted">Taxable</dt>
                  <dd className="m-0 font-semibold tabular-nums">{money(quotation.totals.taxable, currency)}</dd>
                </div>
              </>
            )}
            <div className="flex justify-between gap-4 py-0.5">
              <dt className="text-muted">GST ({quotation.totals.gstRatePercent}%)</dt>
              <dd className="m-0 font-semibold tabular-nums">{money(quotation.totals.gst, currency)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t-2 border-line-strong pt-2 text-[16px]">
              <dt className="font-bold">Total</dt>
              <dd className="m-0 font-bold tabular-nums">{money(quotation.totals.total, currency)}</dd>
            </div>
          </dl>
        </section>

        {quotation.notes && (
          <section aria-label="Notes" className="border-t border-line pt-4">
            <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">Notes</h2>
            <p className="mt-1 text-[13.5px] whitespace-pre-line">{quotation.notes}</p>
          </section>
        )}

        {quotation.poNumber && (
          <section aria-label="Purchase order" className="border-t border-line pt-4">
            <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">Purchase order</h2>
            <p className="mt-1 text-[13.5px]">
              <span className="font-semibold">{quotation.poNumber}</span>
              {quotation.poDate ? ` · dated ${formatDate(quotation.poDate)}` : ""}
            </p>
          </section>
        )}

        <footer className="mt-8 border-t border-line pt-3 text-xs text-muted">
          Quotation {quotation.number} · valid until {formatDate(quotation.validUntil)} · generated{" "}
          {new Date(data.generatedAt).toLocaleString()}
        </footer>
      </article>
    </>
  );
}
