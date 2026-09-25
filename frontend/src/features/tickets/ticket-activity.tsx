"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { type TicketDetail, useTicketLabels } from "./api";
import { describeEvent, formatWhen } from "./format";

/** Newest first, so the latest change is read first. */
export function TicketActivity({
  ticket,
  onChanged,
}: {
  ticket: TicketDetail;
  onChanged: (next: TicketDetail) => void;
}) {
  const labels = useTicketLabels();
  const events = [...ticket.events].reverse();
  const now = new Date();

  return (
    <Card aria-labelledby="activity-title">
      <CardHeader
        titleId="activity-title"
        title="Activity"
        meta={`${ticket.events.length} updates`}
      />
      <CardBody className="flex flex-col gap-5">
        {ticket.stage !== "CLOSED" && ticket.stage !== "CANCELLED" && (
          <AddNoteForm ticketId={ticket.id} onChanged={onChanged} />
        )}
        <ol className="m-0 list-none p-0">
          {events.map((event, index) => {
            const { what, detail } = describeEvent(event, labels.stage);
            const system = !event.actor;
            const highlight = event.type === "NOTE" || event.type === "SLA_BREACHED";
            return (
              <li
                key={event.id}
                className="relative grid grid-cols-[18px_1fr] gap-2.5 pb-4 last:pb-0"
              >
                {index < events.length - 1 && (
                  <span aria-hidden className="absolute top-5 bottom-0 left-[8px] w-0.5 bg-line" />
                )}
                <span
                  aria-hidden
                  className={cn(
                    "z-[1] mt-0.5 size-[18px] rounded-full border-2",
                    event.type === "SLA_BREACHED"
                      ? "border-bad bg-bad-bg"
                      : highlight
                        ? "border-accent bg-accent-soft"
                        : "border-line-strong bg-surface-2",
                  )}
                />
                <div className="min-w-0 text-[13.5px]">
                  <span className="font-semibold">
                    {system ? "ServiceBridge" : event.actor!.name}
                  </span>{" "}
                  {what}
                  {detail && <span className="text-muted"> · {detail}</span>}
                  <time dateTime={event.createdAt} className="block text-xs text-muted">
                    {formatWhen(event.createdAt, now)}
                  </time>
                  {event.note && (
                    <p className="mt-1.5 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] whitespace-pre-line [overflow-wrap:anywhere]">
                      {event.note}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}

function AddNoteForm({
  ticketId,
  onChanged,
}: {
  ticketId: string;
  onChanged: (next: TicketDetail) => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!note.trim()) return setError("Write a note before adding it.");
    setSaving(true);
    try {
      onChanged(
        await apiFetch<TicketDetail>(`/tickets/${ticketId}/notes`, {
          method: "POST",
          json: { note },
        }),
      );
      setNote("");
      setError(undefined);
      toast.success("Note added.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <Field
        label="Add a note"
        error={error}
        help="Only your team sees notes. The customer isn't notified."
      >
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you find or do?"
          />
        )}
      </Field>
      <div>
        <Button type="submit" size="sm" variant="strong" loading={saving}>
          Add note
        </Button>
      </div>
    </form>
  );
}
