"use client";

import { Clock } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { TicketAction, TicketDetail } from "./api";
import { useTicketLookups } from "./api";
import { slaText } from "./format";

/** Steps that need words from the user get a dialog; the rest happen on click. */
const DIALOGS: Partial<
  Record<
    TicketAction,
    {
      title: string;
      description: string;
      noteLabel: string;
      noteHelp?: string;
      confirm: string;
      minLength?: number;
      suggestions?: string[];
      variant?: ButtonVariant;
    }
  >
> = {
  resolve: {
    title: "Mark this ticket resolved?",
    description:
      "The area manager is asked to verify it. The customer gets a feedback link once it's closed.",
    noteLabel: "What was done",
    noteHelp: "Visible to the service team and on the customer's visit report.",
    confirm: "Mark resolved",
    minLength: 10,
  },
  hold: {
    title: "Put this ticket on hold",
    description: "The SLA clock pauses until work resumes.",
    noteLabel: "Reason",
    confirm: "Put on hold",
    suggestions: [
      "Waiting for a spare part",
      "Waiting for the customer's PO",
      "Customer site not ready",
    ],
    variant: "strong",
  },
  decline: {
    title: "Decline this ticket?",
    description: "It goes back to the area manager to choose another engineer.",
    noteLabel: "Why can't you take it?",
    confirm: "Decline",
    variant: "strong",
  },
  reject: {
    title: "Send back for more work?",
    description:
      "The resolution is undone and the engineer is asked to continue. The SLA clock keeps running.",
    noteLabel: "What still needs doing",
    confirm: "Send back",
    variant: "strong",
  },
  cancel: {
    title: "Cancel this ticket?",
    description: "Use this when no work is needed. Cancelled tickets can't be reopened.",
    noteLabel: "Reason",
    confirm: "Cancel ticket",
    variant: "danger",
  },
  reopen: {
    title: "Reopen this ticket?",
    description: "It counts as a repeat visit and gets a fresh resolution target.",
    noteLabel: "What's wrong again",
    confirm: "Reopen",
  },
};

const DONE: Record<TicketAction, string> = {
  triage: "Acknowledged. The ticket is with the area manager.",
  assign: "Engineer assigned.",
  accept: "Accepted. The response time is met.",
  decline: "Declined. The area manager will choose someone else.",
  arrive: "Marked as on site.",
  start: "Work started.",
  hold: "Ticket put on hold. The SLA clock is paused.",
  resume: "Work resumed. The SLA clock is running again.",
  resolve: "Marked resolved. The area manager has been asked to verify it.",
  verify: "Fix verified. The ticket can be closed.",
  reject: "Sent back to the engineer.",
  close: "Ticket closed.",
  cancel: "Ticket cancelled.",
  reopen: "Ticket reopened.",
};

/** The main next step is the primary button; the rest are secondary, cancel last. */
const ORDER: TicketAction[] = [
  "accept",
  "arrive",
  "start",
  "resolve",
  "verify",
  "close",
  "resume",
  "triage",
  "reopen",
  "hold",
  "reject",
  "decline",
  "cancel",
];

interface TicketActionBarProps {
  ticket: TicketDetail;
  onChanged: (next: TicketDetail) => void;
}

export function TicketActionBar({ ticket, onChanged }: TicketActionBarProps) {
  const toast = useToast();
  const lookups = useTicketLookups();
  const [open, setOpen] = useState<TicketAction | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<TicketAction | null>(null);

  const actions = ORDER.filter((a) => ticket.actions.includes(a));
  if (!actions.length) return null;
  const label = (a: TicketAction) => lookups.data?.actions[a]?.label ?? a;

  const run = async (action: TicketAction, text?: string) => {
    setBusy(action);
    try {
      const next = await apiFetch<TicketDetail>(`/tickets/${ticket.id}/actions`, {
        method: "POST",
        json: { action, version: ticket.version, note: text || undefined },
      });
      onChanged(next);
      setOpen(null);
      toast.success(DONE[action]);
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : undefined;
      const message =
        apiError?.fieldMessage("note") ?? apiError?.message ?? "Something went wrong. Try again.";
      if (open) setError(message);
      else toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const start = (action: TicketAction) => {
    if (!DIALOGS[action]) return void run(action);
    setNote("");
    setError(undefined);
    setOpen(action);
  };

  const confirm = (event: FormEvent) => {
    event.preventDefault();
    const dialog = open && DIALOGS[open];
    if (!open || !dialog) return;
    const text = note.trim();
    if (!text) return setError(`Add a short ${dialog.noteLabel.toLowerCase()}.`);
    if (dialog.minLength && text.length < dialog.minLength)
      return setError(`Describe it in at least ${dialog.minLength} characters.`);
    void run(open, text);
  };

  const dialog = open ? DIALOGS[open] : undefined;
  const clock = ticket.sla.state === "none" ? null : slaText(ticket.sla);

  return (
    <>
      <div className="sticky bottom-0 z-20 -mx-4 -mb-12 flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] lg:-mx-7 lg:px-7">
        {clock && (
          <span className="flex items-center gap-1.5 text-[13px] text-muted">
            <Clock className="size-3.5" aria-hidden />
            {ticket.sla.clock === "response" ? "Response" : "Resolution"}: {clock}
          </span>
        )}
        <div className="flex flex-wrap gap-2 max-sm:w-full sm:ml-auto [&>*]:max-sm:flex-1">
          {actions.map((action, index) => (
            <Button
              key={action}
              variant={
                index === 0 && action !== "cancel"
                  ? "primary"
                  : action === "cancel"
                    ? "ghost"
                    : "secondary"
              }
              loading={busy === action && !open}
              disabled={!!busy}
              onClick={() => start(action)}
            >
              {label(action)}
            </Button>
          ))}
        </div>
      </div>

      <Dialog
        open={!!dialog}
        onClose={() => setOpen(null)}
        title={dialog?.title ?? ""}
        description={dialog?.description}
        footer={
          <>
            <Button onClick={() => setOpen(null)}>Cancel</Button>
            <Button
              variant={dialog?.variant ?? "primary"}
              type="submit"
              form="action-form"
              loading={!!busy}
            >
              {dialog?.confirm}
            </Button>
          </>
        }
      >
        {dialog && (
          <form id="action-form" onSubmit={confirm} noValidate className="flex flex-col gap-3">
            {dialog.suggestions && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common reasons">
                {dialog.suggestions.map((s) => (
                  <Button key={s} size="sm" variant="ghost" onClick={() => setNote(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            )}
            <Field label={dialog.noteLabel} required error={error} help={dialog.noteHelp}>
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
          </form>
        )}
      </Dialog>
    </>
  );
}
