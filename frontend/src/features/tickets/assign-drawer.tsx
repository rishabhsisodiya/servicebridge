"use client";

import { MapPin, Wrench } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Tag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { AvailabilityPill } from "@/features/engineers/engineers";
import { type EngineerSuggestion, fetcher, type TicketDetail } from "./api";

interface AssignDrawerProps {
  ticket: TicketDetail;
  open: boolean;
  onClose: () => void;
  onChanged: (next: TicketDetail) => void;
}

/** Engineers ranked by skill match, same region, then fewest open jobs. The manager decides. */
export function AssignDrawer(props: AssignDrawerProps) {
  return <AssignForm key={props.open ? "open" : "closed"} {...props} />;
}

function AssignForm({ ticket, open, onClose, onChanged }: AssignDrawerProps) {
  const toast = useToast();
  const suggestions = useSWR<EngineerSuggestion[]>(
    open ? `/tickets/${ticket.id}/engineers` : null,
    fetcher,
  );
  const [engineerId, setEngineerId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!engineerId) return setError("Choose an engineer.");
    setSaving(true);
    try {
      const next = await apiFetch<TicketDetail>(`/tickets/${ticket.id}/actions`, {
        method: "POST",
        json: {
          action: "assign",
          engineerId,
          note: note.trim() || undefined,
          version: ticket.version,
        },
      });
      const name = suggestions.data?.find((e) => e.id === engineerId)?.name ?? "The engineer";
      toast.success(`${name} assigned.`);
      onChanged(next);
      onClose();
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : undefined;
      setError(
        apiError?.fieldMessage("engineerId") ??
          apiError?.message ??
          "Something went wrong. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dirty={engineerId !== "" || note.trim() !== ""}
      title={ticket.engineer ? "Reassign engineer" : "Assign an engineer"}
      description={
        ticket.equipment
          ? `Best matches for ${ticket.equipment.itemName ?? ticket.equipment.itemCode ?? "this machine"} are listed first.`
          : "No machine on this ticket, so engineers are ranked by region and workload."
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="assign-form" variant="primary" loading={saving}>
            Assign
          </Button>
        </>
      }
    >
      <form id="assign-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-lg bg-bad-bg px-3.5 py-2.5 text-[13px] text-bad">
            {error}
          </p>
        )}
        {suggestions.isLoading && <TableSkeleton rows={4} label="Loading engineers" />}
        {suggestions.error && (
          <ErrorState title="Couldn't load engineers" onRetry={() => void suggestions.mutate()} />
        )}
        {suggestions.data?.length === 0 && (
          <EmptyState
            icon={<Wrench className="size-6" />}
            title="No active engineers"
            description="Invite engineers under Settings → Users & roles."
          />
        )}
        {suggestions.data && suggestions.data.length > 0 && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[13px] font-semibold">Engineer</legend>
            <div className="flex flex-col overflow-hidden rounded-lg border border-line">
              {suggestions.data.map((e) => (
                <label
                  key={e.id}
                  className="flex cursor-pointer items-start gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0 hover:bg-surface-2 has-[:checked]:bg-accent-soft"
                >
                  <input
                    type="radio"
                    name="engineer"
                    value={e.id}
                    checked={engineerId === e.id}
                    onChange={() => {
                      setEngineerId(e.id);
                      setError(undefined);
                    }}
                    disabled={e.current && ticket.stage === "ASSIGNED"}
                    className="mt-1 size-4 accent-[var(--accent-strong)]"
                  />
                  <span className="min-w-0 flex-1 text-[13px]">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {e.name}
                      {e.current && <Tag>Current</Tag>}
                      <AvailabilityPill duty={e.dutyStatus} onVisit={e.onVisit} />
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" aria-hidden />
                        {e.region ?? "No region"}
                        {e.sameRegion && " (same region)"}
                      </span>
                      <span>
                        {e.skills.length ? `Skills: ${e.skills.join(", ")}` : "No matching skill"}
                      </span>
                    </span>
                  </span>
                  <span className="text-xs whitespace-nowrap text-muted">{e.openTickets} open</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Field label="Note for the engineer" help="Optional. Shown on the ticket's activity.">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              maxLength={2000}
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
            />
          )}
        </Field>
      </form>
    </Drawer>
  );
}
