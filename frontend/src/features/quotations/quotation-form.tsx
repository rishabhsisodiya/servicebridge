"use client";

import { AlertTriangle, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { StatusPill } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SearchInput } from "@/components/ui/list-controls";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import {
  addLine,
  removeLine,
  searchLineItems,
  updateLine,
  updateQuotation,
  type LineItemOption,
  type QuotationDetail,
} from "./api";
import { money, totalsCurrency } from "./display";
import { QuotationActionBar } from "./quotation-actions";
import { TotalsTable } from "./totals-table";

const fail =
  (toast: { error: (message: string) => void }, onConflict: () => Promise<unknown>) =>
  (caught: unknown) => {
    if (caught instanceof ApiError && caught.code === "VERSION_CONFLICT") {
      void onConflict();
      toast.error("This quotation changed since you opened it. It's refreshed — try again.");
      return;
    }
    toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
  };

const tomorrow = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
};

/**
 * A draft quotation, editable by customer support and the service manager.
 * Every mutation re-reads the quotation so the version — and the live totals
 * the API computes — stay fresh.
 */
export function QuotationForm({
  quotation,
  onChanged,
  onDeleted,
  onRevised,
}: {
  quotation: QuotationDetail;
  onChanged: () => Promise<unknown>;
  onDeleted: () => void;
  onRevised: (next: QuotationDetail) => void;
}) {
  // Keyed by version so a saved edit resets the local field state.
  return (
    <div className="flex flex-col gap-4">
      <HeaderCard key={`header-${quotation.version}`} quotation={quotation} onChanged={onChanged} />
      <LinesCard key={`lines-${quotation.version}`} quotation={quotation} onChanged={onChanged} />
      <Card aria-labelledby="totals-title">
        <CardHeader
          titleId="totals-title"
          title="Totals"
          meta={
            <StatusPill tone="neutral" plain>
              Computed live
            </StatusPill>
          }
        />
        <CardBody>
          <TotalsTable totals={quotation.totals} />
          <p className="mt-2 text-xs text-muted">
            The discount comes off the subtotal; GST applies to the discounted amount.
          </p>
        </CardBody>
      </Card>
      <QuotationActionBar
        quotation={quotation}
        onChanged={onChanged}
        onRevised={onRevised}
        onDeleted={onDeleted}
      />
    </div>
  );
}

/* ── Header fields: valid-until, discount, notes ──────────────────────── */

function HeaderCard({
  quotation,
  onChanged,
}: {
  quotation: QuotationDetail;
  onChanged: () => Promise<unknown>;
}) {
  const toast = useToast();
  const [validUntil, setValidUntil] = useState(quotation.validUntil.slice(0, 10));
  const [discount, setDiscount] = useState(
    quotation.discountPercent == null ? "" : String(Number(quotation.discountPercent)),
  );
  const [notes, setNotes] = useState(quotation.notes ?? "");
  const [saving, setSaving] = useState(false);

  const dirty =
    validUntil !== quotation.validUntil.slice(0, 10) ||
    discount !== (quotation.discountPercent == null ? "" : String(Number(quotation.discountPercent))) ||
    notes !== (quotation.notes ?? "");

  const save = async () => {
    const discountText = discount.trim();
    const discountValue = discountText === "" ? null : Number(discountText);
    if (discountValue != null && (!Number.isFinite(discountValue) || discountValue < 0 || discountValue > 100)) {
      return toast.error("The discount must be between 0 and 100 percent.");
    }
    setSaving(true);
    try {
      await updateQuotation(quotation.id, {
        validUntil,
        discountPercent: discountValue,
        notes: notes.trim(),
        version: quotation.version,
      });
      await onChanged();
      toast.success("Quotation updated.");
    } catch (caught) {
      fail(toast, onChanged)(caught);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card aria-labelledby="details-title">
      <CardHeader
        titleId="details-title"
        title="Quotation details"
        actions={
          <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void save()}>
            Save details
          </Button>
        }
      />
      <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Valid until" required help="The offer lapses after this date.">
          {(props) => (
            <Input
              {...props}
              type="date"
              min={tomorrow()}
              value={validUntil}
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
        <div className="sm:col-span-2">
          <Field label="Notes" help="Anything the customer should read with the quote.">
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                maxLength={20000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Payment terms, lead time, exclusions…"
              />
            )}
          </Field>
        </div>
      </CardBody>
    </Card>
  );
}

/* ── Line items ───────────────────────────────────────────────────────── */

function LinesCard({
  quotation,
  onChanged,
}: {
  quotation: QuotationDetail;
  onChanged: () => Promise<unknown>;
}) {
  const toast = useToast();
  const failWith = fail(toast, onChanged);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<LineItemOption | null>(null);
  const [qty, setQty] = useState("1");
  const [rate, setRate] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const currency = totalsCurrency(quotation.totals);

  const { data: results, isLoading: searching } = useSWR<LineItemOption[]>(
    query ? ["line-item-search", query] : null,
    ([, q]: [string, string]) => searchLineItems(q),
  );

  const add = async () => {
    if (!picked) return;
    const quantity = Number(qty);
    const rateValue = Number(rate);
    if (!Number.isFinite(quantity) || quantity < 0.01)
      return toast.error("Quantity must be at least 0.01.");
    if (!Number.isFinite(rateValue) || rateValue < 0)
      return toast.error("Rate can't be negative.");
    setAdding(true);
    try {
      await addLine(quotation.id, { itemId: picked.id, quantity, rate: rateValue });
      setPicked(null);
      setQty("1");
      setRate("");
      setQuery("");
      await onChanged();
      toast.success(`${picked.name} added.`);
    } catch (caught) {
      failWith(caught);
    } finally {
      setAdding(false);
    }
  };

  const saveLine = async (lineId: string, name: string, quantity: number, rateValue: number) => {
    if (!Number.isFinite(quantity) || quantity < 0.01)
      return toast.error("Quantity must be at least 0.01.");
    if (!Number.isFinite(rateValue) || rateValue < 0)
      return toast.error("Rate can't be negative.");
    setBusyLine(lineId);
    try {
      await updateLine(quotation.id, lineId, {
        quantity,
        rate: rateValue,
        version: quotation.version,
      });
      await onChanged();
    } catch (caught) {
      failWith(caught);
    } finally {
      setBusyLine(null);
    }
  };

  const remove = async (lineId: string, name: string) => {
    setBusyLine(lineId);
    try {
      await removeLine(quotation.id, lineId);
      await onChanged();
      toast.success(`${name} removed.`);
    } catch (caught) {
      failWith(caught);
    } finally {
      setBusyLine(null);
    }
  };

  return (
    <Card aria-labelledby="lines-title">
      <CardHeader
        titleId="lines-title"
        title="Line items"
        meta={quotation.lines.length ? `${quotation.lines.length}` : undefined}
      />
      <CardBody className="flex flex-col gap-3">
        {quotation.lines.length === 0 ? (
          <p className="text-[13px] text-muted">
            No lines yet. Add the spares or labour this quote covers — at least one line is
            needed before it can be sent.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {quotation.lines.map((line) => (
              <LineRow
                key={`${line.id}-${quotation.version}`}
                lineId={line.id}
                name={line.item.name}
                code={line.item.itemCode}
                uom={line.item.uom}
                quantity={Number(line.quantity)}
                rate={Number(line.rate)}
                currency={currency}
                busy={busyLine === line.id}
                onSave={(q, r) => void saveLine(line.id, line.item.name, q, r)}
                onRemove={() => void remove(line.id, line.item.name)}
              />
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          {!picked ? (
            <>
              <SearchInput
                label="Find an item"
                placeholder="Search by code or name…"
                onChange={setQuery}
              />
              {searching && <p className="text-[13px] text-muted">Searching…</p>}
              {results && results.length > 0 && (
                <ul
                  className="m-0 flex max-h-48 list-none flex-col gap-1 overflow-y-auto p-0"
                  role="listbox"
                  aria-label="Matching items"
                >
                  {results.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          setPicked(item);
                          setQuery("");
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{item.name}</span>
                          <span className="block text-xs text-muted">
                            {item.itemCode}
                            {item.uom ? ` · ${item.uom}` : ""}
                          </span>
                        </span>
                        <Plus className="size-4 shrink-0 text-muted" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {results && query && results.length === 0 && (
                <p className="text-[13px] text-muted">No items match “{query}”.</p>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line px-3 py-2">
              <span className="min-w-0 flex-1 basis-40 text-[13.5px]">
                <span className="block truncate font-semibold">{picked.name}</span>
                <span className="block text-xs text-muted">{picked.itemCode}</span>
              </span>
              <Field label="Qty">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    inputMode="decimal"
                    min={0.01}
                    step="any"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className="w-24"
                  />
                )}
              </Field>
              <Field label={`Rate (${currency})`}>
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    placeholder="0.00"
                    className="w-32"
                  />
                )}
              </Field>
              <Button size="sm" loading={adding} onClick={() => void add()}>
                Add line
              </Button>
              <IconButton label="Pick a different item" size="sm" onClick={() => setPicked(null)}>
                <X className="size-4" aria-hidden />
              </IconButton>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function LineRow({
  name,
  code,
  uom,
  quantity,
  rate,
  currency,
  busy,
  onSave,
  onRemove,
}: {
  lineId: string;
  name: string;
  code: string;
  uom: string | null;
  quantity: number;
  rate: number;
  currency: string;
  busy: boolean;
  onSave: (quantity: number, rate: number) => void;
  onRemove: () => void;
}) {
  const [qty, setQty] = useState(String(quantity));
  const [rateText, setRateText] = useState(String(rate));
  const [confirming, setConfirming] = useState(false);

  const dirty = Number(qty) !== quantity || Number(rateText) !== rate;
  const blur = () => {
    if (dirty && !busy) onSave(Number(qty), Number(rateText));
  };

  return (
    <li className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg border border-line px-3 py-2">
      <span className="min-w-0 flex-1 basis-40">
        <span className="block truncate text-[13.5px] font-semibold">{name}</span>
        <span className="block text-xs text-muted">
          {code}
          {uom ? ` · ${uom}` : ""}
        </span>
      </span>
      <Field label="Qty">
        {(props) => (
          <Input
            {...props}
            type="number"
            inputMode="decimal"
            min={0.01}
            step="any"
            value={qty}
            disabled={busy}
            onChange={(e) => setQty(e.target.value)}
            onBlur={blur}
            className="w-24"
          />
        )}
      </Field>
      <Field label={`Rate (${currency})`}>
        {(props) => (
          <Input
            {...props}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={rateText}
            disabled={busy}
            onChange={(e) => setRateText(e.target.value)}
            onBlur={blur}
            className="w-32"
          />
        )}
      </Field>
      <span className="pb-2 text-[13.5px] font-semibold tabular-nums">
        {money(quantity * rate, currency)}
      </span>
      {confirming ? (
        <span className="flex items-center gap-1 pb-1.5">
          <Button size="sm" variant="danger" disabled={busy} onClick={onRemove}>
            Remove
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <IconButton
          label={`Remove ${name}`}
          size="sm"
          disabled={busy}
          onClick={() => setConfirming(true)}
          className="mb-1.5"
        >
          <Trash2 className="size-4" aria-hidden />
        </IconButton>
      )}
    </li>
  );
}

export function QuotationReadonlyHint({ locked }: { locked?: boolean }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-info-bg px-3 py-2 text-[13px] text-info">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {locked
        ? "This draft is read-only for you — you don't have permission to edit quotations."
        : "Only draft quotations can be edited. This one is locked."}
    </p>
  );
}
