"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import {
  cancelQuotation,
  deleteQuotation,
  recordPo,
  reviseQuotation,
  sendQuotation,
  type QuotationDetail,
} from "./api";
import { formatDate, money, totalsCurrency } from "./display";

type DialogKind = "send" | "po" | "revise" | "cancel" | "delete" | null;

const fail =
  (toast: { error: (message: string) => void }) =>
  (caught: unknown, onConflict: () => Promise<unknown>) => {
    if (caught instanceof ApiError && caught.code === "VERSION_CONFLICT") {
      void onConflict();
      toast.error("This quotation changed since you opened it. It's refreshed — try again.");
      return;
    }
    toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
  };

/**
 * The sticky actions for one quotation, shown by status. Drafts can be sent
 * or deleted; sent quotations take a PO, a revision or a cancellation; expired
 * quotations can be revised. The API is the real permission check; the UI only
 * hides buttons the viewer may not use.
 */
export function QuotationActionBar({
  quotation,
  onChanged,
  onRevised,
  onDeleted,
}: {
  quotation: QuotationDetail;
  /** Re-read the quotation after a mutation (bumps the version). */
  onChanged: () => Promise<unknown>;
  /** A revision returns the new draft; the screen navigates to it. */
  onRevised?: (next: QuotationDetail) => void;
  /** A deleted draft is gone; the screen navigates away. */
  onDeleted?: () => void;
}) {
  const { can } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState<DialogKind>(null);
  const [busy, setBusy] = useState(false);
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [dialogError, setDialogError] = useState<string>();
  const failWith = fail(toast);

  if (quotation.status !== "DRAFT" && quotation.status !== "SENT" && quotation.status !== "EXPIRED") {
    return null;
  }
  const editable = can("quotations.edit");
  const creatable = can("quotations.create");
  const deletable = can("quotations.delete");
  const draftActions = quotation.status === "DRAFT";
  const sentActions = quotation.status === "SENT";
  const expiredActions = quotation.status === "EXPIRED";
  const hasActions =
    (draftActions && (deletable || editable)) ||
    (sentActions && editable) ||
    (expiredActions && creatable);
  if (!hasActions) return null;

  const run = async (
    work: () => Promise<QuotationDetail | void>,
    done: string,
    after?: () => void,
  ) => {
    setBusy(true);
    try {
      const result = await work();
      setOpen(null);
      toast.success(done);
      if (after) after();
      else await onChanged();
      return result;
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "VERSION_CONFLICT") {
        setOpen(null);
        failWith(caught, onChanged);
      } else if (open) {
        setDialogError(
          caught instanceof ApiError ? caught.message : "Something went wrong. Try again.",
        );
      } else {
        failWith(caught, onChanged);
      }
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const send = () =>
    run(() => sendQuotation(quotation.id), `Quotation ${quotation.number} sent.`);
  const record = () =>
    run(
      () =>
        recordPo(quotation.id, {
          poNumber: poNumber.trim(),
          poDate: poDate || undefined,
          version: quotation.version,
        }),
      `PO ${poNumber.trim()} recorded against ${quotation.number}.`,
    );
  const revise = async () => {
    const next = await run(
      () => reviseQuotation(quotation.id, quotation.version),
      `Revised as a new draft.`,
    );
    if (next && onRevised) onRevised(next);
  };
  const cancel = () =>
    run(() => cancelQuotation(quotation.id, quotation.version), `Quotation ${quotation.number} cancelled.`);
  const remove = () =>
    run(
      () => deleteQuotation(quotation.id),
      `Draft ${quotation.number} deleted.`,
      () => onDeleted?.(),
    );

  const openDialog = (kind: Exclude<DialogKind, null>) => {
    setDialogError(undefined);
    setPoNumber("");
    setPoDate("");
    setOpen(kind);
  };

  const confirmPo = (event: FormEvent) => {
    event.preventDefault();
    if (!poNumber.trim()) return setDialogError("Enter the customer's PO number.");
    void record();
  };

  const currency = totalsCurrency(quotation.totals);

  return (
    <>
      <div className="sticky bottom-0 z-20 -mx-4 -mb-12 flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] lg:-mx-7 lg:px-7">
        {draftActions && deletable && (
          <Button variant="danger" onClick={() => openDialog("delete")} className="max-sm:flex-1">
            Delete draft
          </Button>
        )}
        {sentActions && editable && (
          <Button variant="secondary" onClick={() => openDialog("cancel")} className="max-sm:flex-1">
            Cancel quotation
          </Button>
        )}
        <span className="sm:ml-auto max-sm:w-full" />
        {expiredActions && creatable && (
          <Button variant="secondary" onClick={() => openDialog("revise")} className="max-sm:flex-1">
            Revise
          </Button>
        )}
        {sentActions && editable && (
          <Button variant="secondary" onClick={() => openDialog("revise")} className="max-sm:flex-1">
            Revise
          </Button>
        )}
        {sentActions && editable && (
          <Button variant="primary" onClick={() => openDialog("po")} className="max-sm:flex-1">
            Record PO
          </Button>
        )}
        {draftActions && editable && (
          <Button variant="primary" onClick={() => openDialog("send")} className="max-sm:flex-1">
            Send quotation
          </Button>
        )}
      </div>

      <Dialog
        open={open === "send"}
        onClose={() => setOpen(null)}
        title={`Send ${quotation.number}?`}
        description="Sending locks the quotation and starts its validity clock. There is no email yet — the printable view is the handover for now."
        footer={
          <>
            <Button onClick={() => setOpen(null)}>Keep editing</Button>
            <Button variant="primary" loading={busy} onClick={() => void send()}>
              Send
            </Button>
          </>
        }
      >
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13.5px]">
          <li>
            {quotation.totals.lineCount}{" "}
            {quotation.totals.lineCount === 1 ? "line" : "lines"} ·{" "}
            {money(quotation.totals.total, currency)}
          </li>
          <li className="text-muted">Valid until {formatDate(quotation.validUntil)}</li>
        </ul>
        {dialogError && <p className="text-[13px] text-bad">{dialogError}</p>}
      </Dialog>

      <Dialog
        open={open === "po"}
        onClose={() => setOpen(null)}
        title={`Record the purchase order for ${quotation.number}`}
        description="Recording the PO closes the offer and, when the PO gate is on, lets work start on the ticket."
        footer={
          <>
            <Button onClick={() => setOpen(null)}>Cancel</Button>
            <Button variant="primary" type="submit" form="po-form" loading={busy}>
              Record PO
            </Button>
          </>
        }
      >
        <form id="po-form" onSubmit={confirmPo} noValidate className="flex flex-col gap-3">
          <Field label="PO number" required error={dialogError}>
            {(props) => (
              <Input
                {...props}
                value={poNumber}
                maxLength={80}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="The number on the customer's purchase order"
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="PO date" help="When the PO was issued. Leave blank if it isn't dated.">
            {(props) => (
              <Input
                {...props}
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
              />
            )}
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={open === "revise"}
        onClose={() => setOpen(null)}
        title={`Revise ${quotation.number}?`}
        description="This quotation becomes read-only and a new draft — with a new number — copies its lines for editing."
        footer={
          <>
            <Button onClick={() => setOpen(null)}>Keep it</Button>
            <Button variant="primary" loading={busy} onClick={() => void revise()}>
              Create revision
            </Button>
          </>
        }
      >
        {dialogError && <p className="text-[13px] text-bad">{dialogError}</p>}
      </Dialog>

      <Dialog
        open={open === "cancel"}
        onClose={() => setOpen(null)}
        title={`Cancel ${quotation.number}?`}
        description="The customer won't be able to act on it any more. Cancelled quotations can't be reopened."
        footer={
          <>
            <Button onClick={() => setOpen(null)}>Keep it</Button>
            <Button variant="danger" loading={busy} onClick={() => void cancel()}>
              Cancel quotation
            </Button>
          </>
        }
      >
        {dialogError && <p className="text-[13px] text-bad">{dialogError}</p>}
      </Dialog>

      <Dialog
        open={open === "delete"}
        onClose={() => setOpen(null)}
        title={`Delete draft ${quotation.number}?`}
        description="The lines and notes on this unsent draft are removed. This can't be undone."
        footer={
          <>
            <Button onClick={() => setOpen(null)}>Keep it</Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              Delete draft
            </Button>
          </>
        }
      >
        {dialogError && <p className="text-[13px] text-bad">{dialogError}</p>}
      </Dialog>
    </>
  );
}
