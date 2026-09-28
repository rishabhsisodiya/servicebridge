"use client";

import { FileSignature, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import type { TicketDetail } from "@/features/tickets/api";
import { createQuotation, listForTicket, type QuotationSummary } from "./api";
import { formatDate, money, QuotationStatusPill, totalsCurrency } from "./display";

const defaultValidUntil = () => {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
};

const minValidUntil = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
};

/**
 * Quotations on the ticket. They exist only on chargeable tickets — AMC and
 * warranty work is covered, so the section hides itself otherwise. Starting a
 * quotation needs quotations.create; the API enforces the chargeable rule too.
 */
export function QuotationTimeline({ ticket }: { ticket: TicketDetail }) {
  const { can } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [validUntil, setValidUntil] = useState(defaultValidUntil);
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [dialogError, setDialogError] = useState<string>();

  const readable = can("quotations.read");
  const chargeable = ticket.coverage === "CHARGEABLE";
  const {
    data: quotations,
    error,
    isLoading,
    mutate,
  } = useSWR<QuotationSummary[], ApiError>(
    readable && chargeable ? `/quotations/ticket/${ticket.id}` : null,
    () => listForTicket(ticket.id),
  );

  if (!readable || !chargeable) return null;

  const canCreate = can("quotations.create");

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const discountText = discount.trim();
    const discountValue = discountText === "" ? undefined : Number(discountText);
    if (
      discountValue !== undefined &&
      (!Number.isFinite(discountValue) || discountValue < 0 || discountValue > 100)
    ) {
      return setDialogError("The discount must be between 0 and 100 percent.");
    }
    setBusy(true);
    try {
      const quotation = await createQuotation({
        ticketId: ticket.id,
        validUntil,
        discountPercent: discountValue,
        notes: notes.trim() || undefined,
      });
      setCreating(false);
      toast.success(`Quotation ${quotation.number} created.`);
      await mutate();
      router.push(`/quotations/${quotation.id}`);
    } catch (caught) {
      setDialogError(
        caught instanceof ApiError ? caught.message : "Couldn't create the quotation. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setDialogError(undefined);
    setValidUntil(defaultValidUntil());
    setDiscount("");
    setNotes("");
    setCreating(true);
  };

  return (
    <>
      <Card aria-labelledby="quotations-title">
        <CardHeader
          titleId="quotations-title"
          title="Quotations"
          meta={quotations?.length ? `${quotations.length}` : undefined}
          actions={
            canCreate && (
              <Button
                size="sm"
                icon={<Plus className="size-4" aria-hidden />}
                onClick={openCreate}
              >
                New quotation
              </Button>
            )
          }
        />
        <CardBody>
          {isLoading && <p className="text-[13px] text-muted">Loading quotations…</p>}
          {error && (
            <ErrorState
              title="Couldn't load quotations"
              description={error.message}
              onRetry={() => void mutate()}
            />
          )}
          {!isLoading && !error && quotations && quotations.length === 0 && (
            <EmptyState
              icon={<FileSignature className="size-6" aria-hidden />}
              title="No quotations yet"
              description="Quote spares and labour for this chargeable ticket. Sending locks the quote and starts its validity clock."
            />
          )}
          {quotations && quotations.length > 0 && (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {quotations.map((q) => (
                <li
                  key={q.id}
                  className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/quotations/${q.id}`}
                        className="font-mono text-[13.5px] font-semibold underline-offset-2 hover:underline"
                      >
                        {q.number}
                      </Link>
                      <QuotationStatusPill status={q.status} />
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {q.totals.lineCount} {q.totals.lineCount === 1 ? "line" : "lines"} ·{" "}
                      {money(q.totals.total, totalsCurrency(q.totals))} · valid until{" "}
                      {formatDate(q.validUntil)}
                      {q.poNumber ? ` · PO ${q.poNumber}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title={`New quotation for ${ticket.number}`}
        description="A draft is created with the next QT number; you add lines on the next screen."
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" type="submit" form="quotation-form" loading={busy}>
              Create draft
            </Button>
          </>
        }
      >
        <form id="quotation-form" onSubmit={create} noValidate className="flex flex-col gap-3">
          <Field label="Valid until" required help="The offer lapses after this date.">
            {(props) => (
              <Input
                {...props}
                type="date"
                value={validUntil}
                min={minValidUntil()}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            )}
          </Field>
          <Field label="Discount %" help="Optional, taken off the subtotal.">
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="any"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                placeholder="0"
              />
            )}
          </Field>
          <Field label="Notes">
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                maxLength={20000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Payment terms, lead time, exclusions…"
              />
            )}
          </Field>
          {dialogError && <p className="text-[13px] text-bad">{dialogError}</p>}
        </form>
      </Dialog>
    </>
  );
}
