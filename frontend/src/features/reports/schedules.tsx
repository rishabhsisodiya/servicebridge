"use client";

import { Clock, Download, Lock, Plus, Trash2, History } from "lucide-react";
import { FormEvent, useState } from "react";
import useSWR from "swr";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { StatusPill } from "@/components/ui/badge";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { CronInput, describeCron } from "./cron-input";
import { RecipientPicker } from "./recipient-picker";
import {
  defaultRange,
  reportsApi,
  type ReportCatalogEntry,
  type ReportRun,
  type ReportSchedule,
} from "./api";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function RunHistory({ schedule }: { schedule: ReportSchedule }) {
  const toast = useToast();
  const { data, error, isLoading } = useSWR<ReportRun[], ApiError>(
    `/report-schedules/${schedule.id}/runs`,
    (key: string) => apiFetch<ReportRun[]>(key),
  );

  const download = async (run: ReportRun) => {
    try {
      await reportsApi.downloadRun(run.id);
      toast.success("The CSV download started.");
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "The download failed.");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Recent runs</h3>
      {isLoading && <TableSkeleton />}
      {error && <ErrorState title="Run history could not load" description={error.message} />}
      {data && data.length === 0 && (
        <p className="text-sm text-muted">No runs yet. The next run happens on schedule.</p>
      )}
      {data && data.length > 0 && (
        <Table>
          <thead>
            <Tr>
              <Th>Started</Th>
              <Th>Status</Th>
              <Th>Rows</Th>
              <Th></Th>
            </Tr>
          </thead>
          <tbody>
            {data.map((run) => (
              <Tr key={run.id}>
                <Td>{formatDateTime(run.startedAt)}</Td>
                <Td>
                  <StatusPill tone={run.status === "SUCCESS" ? "ok" : run.status === "FAILED" ? "bad" : "prog"}>
                    {run.status === "SUCCESS" ? "Succeeded" : run.status === "FAILED" ? "Failed" : "Running"}
                  </StatusPill>
                  {run.error && <p className="mt-1 text-xs text-bad">{run.error}</p>}
                </Td>
                <Td>{run.status === "SUCCESS" ? run.rowCount.toLocaleString("en-IN") : "—"}</Td>
                <Td>
                  {run.hasFile && (
                    <IconButton label="Download this run's CSV" onClick={() => download(run)}>
                      <Download className="size-4" aria-hidden />
                    </IconButton>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function initialScheduleParams(
  schedule: ReportSchedule | null,
  catalog: ReportCatalogEntry[],
): Record<string, string> {
  if (schedule) return schedule.params;
  const range = defaultRange();
  const initial: Record<string, string> = {};
  for (const p of catalog[0]?.params ?? []) {
    if (p.type === "date") initial[p.key] = p.key === "from" ? range.from : range.to;
  }
  return initial;
}

function ScheduleForm({
  catalog,
  schedule,
  onClose,
  onSaved,
}: {
  catalog: ReportCatalogEntry[];
  schedule: ReportSchedule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(schedule?.name ?? "");
  const [reportKey, setReportKey] = useState(schedule?.reportKey ?? catalog[0]?.key ?? "");
  const [params, setParams] = useState<Record<string, string>>(() =>
    initialScheduleParams(schedule, catalog),
  );
  const [cron, setCron] = useState(schedule?.cron ?? "0 8 * * 1");
  const [timezone, setTimezone] = useState(schedule?.timezone ?? "Asia/Kolkata");
  const [recipients, setRecipients] = useState<string[]>(schedule?.recipients ?? []);
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const report = catalog.find((r) => r.key === reportKey) ?? catalog[0];

  // Params default differently for new vs edit; compare against the drawer's
  // own initial values, not a generic blank.
  const dirty =
    name !== (schedule?.name ?? "") ||
    reportKey !== (schedule?.reportKey ?? catalog[0]?.key ?? "") ||
    JSON.stringify(params) !== JSON.stringify(initialScheduleParams(schedule, catalog)) ||
    cron !== (schedule?.cron ?? "0 8 * * 1") ||
    timezone !== (schedule?.timezone ?? "Asia/Kolkata") ||
    JSON.stringify(recipients) !== JSON.stringify(schedule?.recipients ?? []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      if (schedule) {
        await reportsApi.updateSchedule(schedule.id, {
          version: schedule.version,
          name: name.trim(),
          params,
          cron,
          timezone,
          recipients,
        });
        toast.success("Schedule updated.");
      } else {
        await reportsApi.createSchedule({
          name: name.trim(),
          reportKey,
          params,
          cron,
          timezone,
          recipients,
        });
        toast.success("Schedule created. It runs on its own from now on.");
      }
      onSaved();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.fieldMessage("recipients") ??
            caught.fieldMessage("cron") ??
            caught.fieldMessage("name") ??
            caught.message)
          : "Something went wrong.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      dirty={dirty}
      title={schedule ? `Edit “${schedule.name}”` : "New scheduled report"}
      description="The report is rendered with the ticket scope of whoever created the schedule."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {schedule && (
            <Button variant="secondary" onClick={() => setShowHistory((v) => !v)}>
              <History className="size-4" aria-hidden /> {showHistory ? "Hide" : "Show"} run history
            </Button>
          )}
          <Button type="submit" form="schedule-form" variant="strong" loading={saving}>
            {schedule ? "Save changes" : "Create schedule"}
          </Button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Name" required error={error && !name.trim() ? error : undefined}>
          {(p) => (
            <Input
              {...p}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weekly SLA digest"
            />
          )}
        </Field>
        {!schedule && (
          <Field label="Report" required>
            {(p) => (
              <Select {...p} value={reportKey} onChange={(e) => setReportKey(e.target.value)}>
                {catalog.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {report &&
          report.params.map((param) =>
            param.type === "date" ? (
              <Field key={param.key} label={param.label}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={params[param.key] ?? ""}
                    onChange={(e) => setParams((prev) => ({ ...prev, [param.key]: e.target.value }))}
                  />
                )}
              </Field>
            ) : (
              <Field key={param.key} label={param.label}>
                {(p) => (
                  <Select
                    {...p}
                    value={params[param.key] ?? ""}
                    onChange={(e) => setParams((prev) => ({ ...prev, [param.key]: e.target.value }))}
                  >
                    <option value="">All</option>
                    {(param.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ),
          )}
        <CronInput cron={cron} onChange={setCron} timezone={timezone} onTimezoneChange={setTimezone} />
        <RecipientPicker selected={recipients} onChange={setRecipients} />
        {error && name.trim() && <p className="text-sm text-bad">{error}</p>}
      </form>
      {schedule && showHistory && <RunHistory schedule={schedule} />}
    </Drawer>
  );
}

export function SchedulesScreen() {
  const { can, me } = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState<ReportSchedule | "new" | null>(null);
  const allowed = can("reports.schedule");

  const {
    data: schedules,
    error,
    isLoading,
    mutate,
  } = useSWR<ReportSchedule[], ApiError>(
    allowed ? "/report-schedules" : null,
    (key: string) => apiFetch<ReportSchedule[]>(key),
  );
  const { data: catalog } = useSWR<ReportCatalogEntry[], ApiError>(
    allowed ? "/reports" : null,
    (key: string) => apiFetch<ReportCatalogEntry[]>(key),
  );

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="Scheduled reports" />
        <Card>
          <EmptyState
            icon={<Lock className="size-6" />}
            title="You don't have access to this"
            description="Ask your administrator for the report scheduling permission."
          />
        </Card>
      </>
    );
  }

  const reportLabel = (key: string) => catalog?.find((r) => r.key === key)?.label ?? key;

  const toggleActive = async (schedule: ReportSchedule) => {
    try {
      if (schedule.active) await reportsApi.deactivate(schedule.id);
      else await reportsApi.activate(schedule.id);
      toast.success(schedule.active ? "Schedule paused." : "Schedule resumed.");
      mutate();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Something went wrong.");
    }
  };

  const remove = async (schedule: ReportSchedule) => {
    if (!window.confirm(`Delete “${schedule.name}”? Its run history stays for 90 days.`)) return;
    try {
      await reportsApi.deleteSchedule(schedule.id);
      toast.success("Schedule deleted.");
      mutate();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Something went wrong.");
    }
  };

  return (
    <>
      <PageHeader
        title="Scheduled reports"
        description="Automatic deliveries land in recipients' inboxes as CSV attachments."
        actions={
          <Button variant="strong" onClick={() => setEditing("new")} disabled={!catalog}>
            <Plus className="size-4" aria-hidden /> New schedule
          </Button>
        }
      />
      {isLoading && <TableSkeleton />}
      {error && <ErrorState title="Schedules could not load" description={error.message} />}
      {schedules && schedules.length === 0 && (
        <Card>
          <EmptyState
            icon={<Clock className="size-6" />}
            title="No scheduled reports yet"
            description="Create one to email a report to your team automatically."
          />
        </Card>
      )}
      {schedules && schedules.length > 0 && (
        <Card>
          <Table>
            <thead>
              <Tr>
                <Th>Name</Th>
                <Th>Report</Th>
                <Th>Schedule</Th>
                <Th>Recipients</Th>
                <Th>Last run</Th>
                <Th>Active</Th>
                <Th></Th>
              </Tr>
            </thead>
            <tbody>
              {schedules.map((schedule) => (
                <Tr key={schedule.id}>
                  <Td>
                    <button
                      type="button"
                      className="font-semibold text-accent-ink hover:underline"
                      onClick={() => setEditing(schedule)}
                    >
                      {schedule.name}
                    </button>
                  </Td>
                  <Td>{reportLabel(schedule.reportKey)}</Td>
                  <Td>
                    <span className="font-mono text-xs">{schedule.cron}</span>
                    <p className="text-xs text-muted">{describeCron(schedule.cron)}</p>
                  </Td>
                  <Td>
                    <span className="text-sm">{schedule.recipients.length}</span>
                  </Td>
                  <Td>{formatDateTime(schedule.lastRunAt)}</Td>
                  <Td>
                    <Switch
                      label={schedule.active ? "Active" : "Paused"}
                      checked={schedule.active}
                      onChange={() => toggleActive(schedule)}
                    />
                  </Td>
                  <Td>
                    <IconButton label={`Delete ${schedule.name}`} onClick={() => remove(schedule)}>
                      <Trash2 className="size-4" aria-hidden />
                    </IconButton>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {editing && catalog && (
        <ScheduleForm
          catalog={catalog}
          schedule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => mutate()}
        />
      )}
    </>
  );
}
