"use client";

import { Pencil } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Drawer } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/field";
import { ErrorState, TableSkeleton } from "@/components/ui/states";
import { Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import {
  COVERAGE_LABEL,
  COVERAGE_ORDER,
  PRIORITY_ORDER,
  type PriorityRow,
  type SlaData,
  type SlaPolicyRow,
} from "./api";
import {
  DurationInput,
  errorsFrom,
  FormAlert,
  type FormErrors,
  formatDue,
  formatMinutes,
  joinMinutes,
  splitMinutes,
} from "./shared";

const fetcher = <T,>(key: string) => apiFetch<T>(key);

/** SLA targets as a priority × coverage grid; each cell opens an editor. */
export function SlaTab() {
  const sla = useSWR<SlaData>("/service-rules/sla", fetcher);
  const priorities = useSWR<PriorityRow[]>("/service-rules/priorities", fetcher);
  const [editing, setEditing] = useState<SlaPolicyRow | null>(null);

  if (sla.error)
    return <ErrorState title="Couldn't load SLA policies" onRetry={() => void sla.mutate()} />;
  if (!sla.data) return <TableSkeleton label="Loading SLA policies" />;

  const { policies, calendars, timezone } = sla.data;
  const calendarName = new Map(calendars.map((c) => [c.id, c.name]));
  const priorityLabel = (p: string) =>
    priorities.data?.find((row) => row.priority === p)?.label ?? p.toLowerCase();
  const cell = (coverage: string, priority: string) =>
    policies.find((p) => p.coverage === coverage && p.priority === priority);

  return (
    <Card>
      <CardHeader
        title="Response and resolution targets"
        meta={`Coverage comes from the machine: AMC first, then warranty, otherwise chargeable. Times in ${timezone}.`}
      />
      <Table caption="SLA targets by priority and coverage">
        <thead>
          <tr>
            <Th>Priority</Th>
            {COVERAGE_ORDER.map((c) => (
              <Th key={c}>{COVERAGE_LABEL[c]}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PRIORITY_ORDER.map((priority) => (
            <tr key={priority} className="border-t border-line">
              <Th scope="row" className="font-semibold">
                {priorityLabel(priority)}
              </Th>
              {COVERAGE_ORDER.map((coverage) => {
                const policy = cell(coverage, priority);
                if (!policy) return <Td key={coverage}>—</Td>;
                return (
                  <Td key={coverage} className="min-w-48 align-top">
                    <button
                      type="button"
                      onClick={() => setEditing(policy)}
                      aria-label={`Edit ${priorityLabel(priority)} × ${COVERAGE_LABEL[coverage]}`}
                      className="group flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg p-2 text-left hover:bg-surface-2"
                    >
                      <span className="flex w-full items-center justify-between gap-2 text-[13px]">
                        <span>
                          Respond <b>{formatMinutes(policy.responseMinutes)}</b>
                        </span>
                        <Pencil
                          className="size-3.5 text-muted opacity-0 group-hover:opacity-100"
                          aria-hidden
                        />
                      </span>
                      <span className="text-[13px]">
                        Resolve <b>{formatMinutes(policy.resolutionMinutes)}</b>
                      </span>
                      <span className="text-xs text-muted">
                        {calendarName.get(policy.calendarId)}
                      </span>
                    </button>
                  </Td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
      <SlaDrawer
        key={editing?.id ?? "closed"}
        policy={editing}
        data={sla.data}
        title={
          editing ? `${priorityLabel(editing.priority)} · ${COVERAGE_LABEL[editing.coverage]}` : ""
        }
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await sla.mutate();
        }}
      />
    </Card>
  );
}

function SlaDrawer({
  policy,
  data,
  title,
  onClose,
  onSaved,
}: {
  policy: SlaPolicyRow | null;
  data: SlaData;
  title: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [response, setResponse] = useState(splitMinutes(policy?.responseMinutes ?? 60));
  const [resolution, setResolution] = useState(splitMinutes(policy?.resolutionMinutes ?? 480));
  const [calendarId, setCalendarId] = useState(policy?.calendarId ?? "");
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!policy) return;
    const responseMinutes = joinMinutes(response.value, response.unit);
    const resolutionMinutes = joinMinutes(resolution.value, resolution.unit);
    const next: FormErrors = {};
    if (!(responseMinutes >= 15)) next.responseMinutes = "Use at least 15 minutes.";
    if (!(resolutionMinutes >= 15)) next.resolutionMinutes = "Use at least 15 minutes.";
    else if (resolutionMinutes < responseMinutes)
      next.resolutionMinutes = "Resolution cannot be sooner than response.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await apiFetch(`/service-rules/sla/${policy.id}`, {
        method: "PATCH",
        json: { responseMinutes, resolutionMinutes, calendarId, version: policy.version },
      });
      toast.success("SLA target saved.");
      await onSaved();
    } catch (caught) {
      setErrors(errorsFrom(caught, ["responseMinutes", "resolutionMinutes", "calendarId"]));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={!!policy}
      onClose={onClose}
      title={title}
      description="Applies to tickets logged after you save. Open tickets keep their due times."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="sla-form" variant="primary" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="sla-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormAlert message={errors.form} />
        <Field
          label="Respond within"
          required
          error={errors.responseMinutes}
          help="Time until the engineer accepts."
        >
          {(p) => <DurationInput control={p} {...response} onChange={setResponse} />}
        </Field>
        <Field
          label="Resolve within"
          required
          error={errors.resolutionMinutes}
          help="Time until the ticket is resolved."
        >
          {(p) => <DurationInput control={p} {...resolution} onChange={setResolution} />}
        </Field>
        <Field
          label="Count time on"
          error={errors.calendarId}
          help="The clock only runs while this calendar is open. Manage calendars in the Calendars tab."
        >
          {(p) => (
            <Select {...p} value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              {data.calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {policy && (
          <p className="rounded-lg bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">
            With the saved target, a ticket logged now must be answered by{" "}
            <b className="text-text">{formatDue(policy.responseDueAt, data.timezone)}</b> and
            resolved by{" "}
            <b className="text-text">{formatDue(policy.resolutionDueAt, data.timezone)}</b>.
          </p>
        )}
      </form>
    </Drawer>
  );
}
