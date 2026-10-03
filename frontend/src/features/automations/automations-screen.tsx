"use client";

import cronstrue from "cronstrue";
import { CalendarClock, History, Lock, Play, Settings2, Workflow } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { StatusPill, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, Drawer } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { ROLES_KEY, type RoleRow } from "@/features/roles/api";
import { AmcSettingsCard } from "@/features/settings/amc-settings";

type RunStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

interface JobRun {
  id: string;
  trigger: "SCHEDULE" | "MANUAL" | "EVENT";
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  error: string | null;
}

interface Automation {
  key: string;
  name: string;
  description: string;
  category: string;
  kind: "periodic" | "event";
  enabled: boolean;
  cron: string | null;
  timezone: string;
  nextRunAt: string | null;
  lastRun: JobRun | null;
  params: { afterMinutes?: number; notifyRoleId?: string | null };
}

/** Escalation levels that take per-level timer settings. */
const ESCALATION_PARAMS: Record<string, { level: number; roleBased: boolean; defaultAfterMinutes: number }> = {
  "escalation-l1": { level: 1, roleBased: false, defaultAfterMinutes: 60 },
  "escalation-l2": { level: 2, roleBased: true, defaultAfterMinutes: 240 },
  "escalation-l3": { level: 3, roleBased: true, defaultAfterMinutes: 1440 },
};

const RUN_STATUS: Record<RunStatus, { label: string; tone: Tone }> = {
  RUNNING: { label: "Running", tone: "prog" },
  SUCCEEDED: { label: "Succeeded", tone: "ok" },
  FAILED: { label: "Failed", tone: "bad" },
  SKIPPED: { label: "Skipped", tone: "done" },
};

const TRIGGER: Record<JobRun["trigger"], string> = {
  SCHEDULE: "On schedule",
  MANUAL: "Run now",
  EVENT: "Triggered",
};

const PRESETS = [
  { cron: "0 3 * * 0", label: "Weekly, Sunday 03:00" },
  { cron: "30 2 * * *", label: "Daily, 02:30" },
  { cron: "0 */6 * * *", label: "Every 6 hours" },
  { cron: "0 * * * *", label: "Every hour" },
];

export function describeCron(cron: string | null): string {
  if (!cron) return "No schedule";
  try {
    return cronstrue.toString(cron, { use24HourTimeFormat: true, verbose: false });
  } catch {
    return cron;
  }
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

const fetcher = <T,>(key: string) => apiFetch<T>(key);

export function AutomationsScreen() {
  const { can, me } = useSession();
  const toast = useToast();
  const allowed = can("automations.read");
  const canEdit = can("automations.edit");
  const { data, error, isLoading, mutate } = useSWR<Automation[]>(
    allowed ? "/automations" : null,
    fetcher,
    {
      refreshInterval: 10_000,
    },
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<Automation | null>(null);
  const [history, setHistory] = useState<Automation | null>(null);
  const [escalation, setEscalation] = useState<Automation | null>(null);

  const fail = (caught: unknown) =>
    toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");

  const toggle = async (automation: Automation, enabled: boolean) => {
    setBusy(`toggle:${automation.key}`);
    try {
      await apiFetch(`/automations/${automation.key}`, { method: "PATCH", json: { enabled } });
      toast.success(`“${automation.name}” is ${enabled ? "on" : "off"}.`);
      await mutate();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  };

  const runNow = async (automation: Automation) => {
    setBusy(`run:${automation.key}`);
    try {
      await apiFetch(`/automations/${automation.key}/run`, { method: "POST" });
      toast.success(`“${automation.name}” has started. Its result appears here when it finishes.`);
      setTimeout(() => void mutate(), 2000);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  };

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="Automations" />
        <Card>
          <EmptyState
            icon={<Lock className="size-6" />}
            title="You don't have access to this"
            description="Only administrators can manage automations."
          />
        </Card>
      </>
    );
  }

  const groups = [...new Set((data ?? []).map((a) => a.category))];

  return (
    <>
      <PageHeader
        title="Automations"
        description="Background work ERPTick does on its own. Each one can be switched off. Nothing runs unless there is work to do."
      />
      {can("company.read") && <AmcSettingsCard />}
      {isLoading && (
        <Card>
          <TableSkeleton rows={3} label="Loading automations" />
        </Card>
      )}
      {error && !data && (
        <Card>
          <ErrorState
            title="Couldn't load automations"
            description={error instanceof ApiError ? error.message : undefined}
            onRetry={() => void mutate()}
          />
        </Card>
      )}
      {data?.length === 0 && (
        <Card>
          <EmptyState icon={<Workflow className="size-6" />} title="No automations yet" />
        </Card>
      )}

      {groups.map((group) => (
        <Card key={group} aria-labelledby={`group-${group}`}>
          <CardHeader titleId={`group-${group}`} title={group} />
          <ul className="m-0 list-none p-0">
            {data!
              .filter((a) => a.category === group)
              .map((automation) => {
                const last = automation.lastRun;
                return (
                  <li
                    key={automation.key}
                    className="flex flex-wrap items-start gap-4 border-b border-line px-4 py-4 last:border-b-0"
                  >
                    <Switch
                      label={automation.name}
                      checked={automation.enabled}
                      busy={busy === `toggle:${automation.key}`}
                      disabled={!canEdit}
                      onChange={(enabled) => void toggle(automation, enabled)}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <p className="font-semibold">{automation.name}</p>
                      <p className="max-w-[75ch] text-[13px] text-muted">
                        {automation.description}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                        {automation.kind === "periodic" ? (
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="size-3.5" aria-hidden />
                            {describeCron(automation.cron)} ({automation.timezone})
                          </span>
                        ) : (
                          <span>Runs when needed</span>
                        )}
                        {automation.enabled && automation.nextRunAt && (
                          <span>Next: {when(automation.nextRunAt)}</span>
                        )}
                        {!automation.enabled && <span>Switched off</span>}
                        {ESCALATION_PARAMS[automation.key] && (
                          <span>
                            Escalates after{" "}
                            {automation.params.afterMinutes ??
                              ESCALATION_PARAMS[automation.key].defaultAfterMinutes}{" "}
                            min
                          </span>
                        )}
                      </p>
                      {last && (
                        <p className="flex flex-wrap items-center gap-2 text-xs">
                          <StatusPill tone={RUN_STATUS[last.status].tone}>
                            {RUN_STATUS[last.status].label}
                          </StatusPill>
                          <span className="text-muted">{when(last.startedAt)}</span>
                          <span className="min-w-0 [overflow-wrap:anywhere]">
                            {last.error ?? last.summary}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 max-sm:w-full">
                      {automation.kind === "periodic" && canEdit && (
                        <>
                          <Button
                            size="sm"
                            icon={<Play className="size-3.5" aria-hidden />}
                            loading={busy === `run:${automation.key}`}
                            onClick={() => void runNow(automation)}
                          >
                            Run now
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setScheduling(automation)}
                          >
                            Change schedule
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<History className="size-3.5" aria-hidden />}
                        onClick={() => setHistory(automation)}
                      >
                        History
                      </Button>
                      {ESCALATION_PARAMS[automation.key] && canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Settings2 className="size-3.5" aria-hidden />}
                          onClick={() => setEscalation(automation)}
                        >
                          Escalation settings
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        </Card>
      ))}

      <ScheduleDialog
        automation={scheduling}
        onClose={() => setScheduling(null)}
        onSaved={() => void mutate()}
      />
      <EscalationParamsDialog
        automation={escalation}
        onClose={() => setEscalation(null)}
        onSaved={() => void mutate()}
      />
      <HistoryDrawer automation={history} onClose={() => setHistory(null)} />
    </>
  );
}

function ScheduleDialog({
  automation,
  onClose,
  onSaved,
}: {
  automation: Automation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return automation ? (
    <ScheduleForm
      key={automation.key}
      automation={automation}
      onClose={onClose}
      onSaved={onSaved}
    />
  ) : null;
}

function ScheduleForm({
  automation,
  onClose,
  onSaved,
}: {
  automation: Automation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [cron, setCron] = useState(automation.cron ?? "");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  // "custom" is its own choice: picking it keeps the current expression and lets you edit it.
  const [mode, setMode] = useState(PRESETS.some((p) => p.cron === cron) ? cron : "custom");

  const dirty = cron !== (automation.cron ?? "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch(`/automations/${automation.key}`, {
        method: "PATCH",
        json: { cron: cron.trim() },
      });
      toast.success("Schedule saved.");
      onSaved();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.fieldMessage("cron") ?? caught.message)
          : "Something went wrong.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dirty={dirty}
      title={`Schedule for “${automation.name}”`}
      description={`Times are in ${automation.timezone}.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="schedule-form" variant="strong" loading={saving}>
            Save schedule
          </Button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="How often">
          {(p) => (
            <Select
              {...p}
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                if (e.target.value !== "custom") setCron(e.target.value);
                else requestAnimationFrame(() => document.getElementById("schedule-cron")?.focus());
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.cron} value={p.cron}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </Select>
          )}
        </Field>
        <Field
          label="Cron expression"
          error={error}
          help={cron ? `Runs: ${describeCron(cron)}` : "minute hour day-of-month month day-of-week"}
        >
          {(p) => (
            <Input
              {...p}
              id="schedule-cron"
              className="font-mono"
              value={cron}
              readOnly={mode !== "custom"}
              onChange={(e) => setCron(e.target.value)}
              spellCheck={false}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function HistoryDrawer({
  automation,
  onClose,
}: {
  automation: Automation | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useSWR<{ data: JobRun[] }>(
    automation ? `/automations/${automation.key}/runs` : null,
    fetcher,
  );
  return (
    <Drawer
      open={automation !== null}
      onClose={onClose}
      title={automation ? `History: ${automation.name}` : ""}
      description="Most recent runs first. Kept for 90 days."
    >
      {isLoading && <TableSkeleton rows={4} label="Loading history" />}
      {data?.data.length === 0 && <p className="text-muted">No runs yet.</p>}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {data?.data.map((run) => (
          <li
            key={run.id}
            className="flex flex-col gap-1 rounded-lg border border-line px-3 py-2.5 text-[13px]"
          >
            <span className="flex flex-wrap items-center gap-2">
              <StatusPill tone={RUN_STATUS[run.status].tone}>
                {RUN_STATUS[run.status].label}
              </StatusPill>
              <span className="text-muted">
                {when(run.startedAt)} · {TRIGGER[run.trigger]}
              </span>
            </span>
            <span className="[overflow-wrap:anywhere]">{run.error ?? run.summary ?? "—"}</span>
          </li>
        ))}
      </ol>
    </Drawer>
  );
}

function EscalationParamsDialog({
  automation,
  onClose,
  onSaved,
}: {
  automation: Automation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return automation && ESCALATION_PARAMS[automation.key] ? (
    <EscalationParamsForm
      key={automation.key}
      automation={automation}
      onClose={onClose}
      onSaved={onSaved}
    />
  ) : null;
}

/**
 * Per-level escalation settings: how long to wait before escalating, and (for
 * levels 2 and 3) which role gets notified. Params merge with what's stored,
 * and 422 field errors land next to the field they belong to.
 */
function EscalationParamsForm({
  automation,
  onClose,
  onSaved,
}: {
  automation: Automation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { can } = useSession();
  const config = ESCALATION_PARAMS[automation.key];
  const [afterMinutes, setAfterMinutes] = useState(
    String(automation.params.afterMinutes ?? config.defaultAfterMinutes),
  );
  const [notifyRoleId, setNotifyRoleId] = useState(automation.params.notifyRoleId ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const roles = useSWR<RoleRow[]>(
    config.roleBased && can("roles.read") ? ROLES_KEY : null,
    fetcher,
  );

  const dirty =
    afterMinutes !== String(automation.params.afterMinutes ?? config.defaultAfterMinutes) ||
    notifyRoleId !== (automation.params.notifyRoleId ?? "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch(`/automations/${automation.key}`, {
        method: "PATCH",
        json: {
          params: {
            afterMinutes: Number(afterMinutes),
            ...(config.roleBased ? { notifyRoleId: notifyRoleId || null } : {}),
          },
        },
      });
      toast.success(`“${automation.name}” settings saved.`);
      onSaved();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && caught.fields.length) {
        const fieldErrors: Record<string, string> = {};
        for (const field of caught.fields) fieldErrors[field.field] = field.message;
        setErrors(fieldErrors);
      } else {
        toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dirty={dirty}
      title={`Escalation settings: ${automation.name}`}
      description="Each assignment sets its own timer with these settings."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="escalation-params-form" variant="strong" loading={saving}>
            Save settings
          </Button>
        </>
      }
    >
      <form
        id="escalation-params-form"
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4"
      >
        <Field
          label="Wait before escalating"
          error={errors.afterMinutes}
          help="Whole minutes from 5 to 10080 (a week)."
        >
          {(p) => (
            <div className="flex items-center gap-2.5">
              <Input
                {...p}
                type="number"
                min={5}
                max={10080}
                step={1}
                inputMode="numeric"
                value={afterMinutes}
                onChange={(e) => setAfterMinutes(e.target.value)}
                className="max-w-40"
              />
              <span className="text-[13px] text-muted">minutes</span>
            </div>
          )}
        </Field>
        {config.roleBased && (
          <Field
            label="Notify this role"
            error={errors.notifyRoleId}
            help="Everyone active in this role gets the escalation."
          >
            {(p) => (
              <Select
                {...p}
                value={notifyRoleId}
                disabled={!can("roles.read") || roles.isLoading}
                onChange={(e) => setNotifyRoleId(e.target.value)}
              >
                <option value="">Choose a role…</option>
                {roles.data?.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </form>
    </Dialog>
  );
}
