"use client";

import { Lock, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { StatusPill, Tag, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, Drawer } from "@/components/ui/dialog";

import { PageHeader } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Sub, Table, Td, Th, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";

type JobState = "failed" | "delayed" | "waiting" | "active" | "completed";

interface QueueInfo {
  name: string;
  label: string;
  paused: boolean;
  counts: Record<JobState | "paused", number>;
  last24h: { completed: number; failed: number };
}

interface JobInfo {
  id: string;
  name: string;
  state: string | null;
  data: Record<string, unknown>;
  attemptsMade: number;
  maxAttempts: number;
  createdAt: string;
  processedAt: string | null;
  finishedAt: string | null;
  runAt: string | null;
  failedReason: string | null;
  logs?: string[];
  stacktrace?: string[];
}

interface Page<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

const POLL = { refreshInterval: 5_000, refreshWhenHidden: false } as const;
const fetcher = <T,>(key: string) => apiFetch<T>(key);
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" }) : "—";

export function SystemScreen() {
  const { can, me } = useSession();
  const [tab, setTab] = useState<"queues" | "requests" | "webhooks" | "connections">("queues");

  if (me && !can("system.read")) {
    return (
      <>
        <PageHeader title="System monitor" />
        <Card>
          <EmptyState
            icon={<Lock className="size-6" />}
            title="You don't have access to this"
            description="Only administrators can see the system monitor."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="System monitor"
        description="Background jobs, calls to your ERP and connection health. Refreshes every 5 seconds."
      />
      <Tabs
        label="System monitor sections"
        value={tab}
        onChange={setTab}
        items={[
          { key: "queues", label: "Queues" },
          { key: "requests", label: "ERP requests" },
          { key: "webhooks", label: "Webhooks" },
          { key: "connections", label: "Connections" },
        ]}
      >
        {tab === "queues" && <QueuesTab />}
        {tab === "requests" && <RequestsTab />}
        {tab === "webhooks" && <WebhooksTab />}
        {tab === "connections" && <ConnectionsTab />}
      </Tabs>
    </>
  );
}

function QueuesTab() {
  const canEdit = useSession().can("system.edit");
  const toast = useToast();
  const queues = useSWR<QueueInfo[]>("/system/queues", fetcher, POLL);
  const [selected, setSelected] = useState("system");
  const [state, setState] = useState<JobState>("failed");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<string | null>(null);
  const [confirmClean, setConfirmClean] = useState(false);
  const jobs = useSWR<Page<JobInfo>>(
    `/system/queues/${selected}/jobs?state=${state}&page=${page}`,
    fetcher,
    POLL,
  );
  const queue = queues.data?.find((q) => q.name === selected);

  const act = async (path: string, success: string, body?: unknown) => {
    try {
      await apiFetch(path, { method: "POST", json: body });
      toast.success(success);
      await Promise.all([queues.mutate(), jobs.mutate()]);
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    }
  };

  if (queues.error && !queues.data) {
    return (
      <ErrorState
        title="Couldn't read the queues"
        description="The queue store (Redis) may be unavailable."
        onRetry={() => void queues.mutate()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(queues.data ?? []).map((q) => (
          <button
            key={q.name}
            type="button"
            aria-pressed={q.name === selected}
            onClick={() => {
              setSelected(q.name);
              setPage(1);
            }}
            className={`flex cursor-pointer flex-col gap-1.5 rounded-xl border bg-surface px-4 py-3 text-left shadow-sm transition-colors hover:bg-surface-2 ${q.name === selected ? "border-accent ring-1 ring-accent" : "border-line"}`}
          >
            <span className="flex items-center gap-2">
              <span className="font-semibold">{q.label}</span>
              {q.paused && <StatusPill tone="warn">Paused</StatusPill>}
            </span>
            <span className="font-mono text-xs text-muted">{q.name}</span>
            <span className="flex flex-wrap gap-x-3 text-xs">
              <span>{q.counts.waiting + q.counts.active} running/waiting</span>
              <span>{q.counts.delayed} scheduled</span>
              <span className={q.counts.failed ? "font-semibold text-bad" : "text-muted"}>
                {q.counts.failed} failed
              </span>
            </span>
            <span className="text-xs text-muted">
              Last 24 h: {q.last24h.completed} done, {q.last24h.failed} failed
            </span>
          </button>
        ))}
        {queues.isLoading && <TableSkeleton rows={2} label="Loading queues" />}
      </div>

      <Card aria-labelledby="jobs-title">
        <CardHeader
          titleId="jobs-title"
          title={queue ? `${queue.label} jobs` : "Jobs"}
          actions={
            queue &&
            canEdit && (
              <>
                <Button
                  size="sm"
                  icon={
                    queue.paused ? (
                      <Play className="size-3.5" aria-hidden />
                    ) : (
                      <Pause className="size-3.5" aria-hidden />
                    )
                  }
                  onClick={() =>
                    void act(
                      `/system/queues/${selected}/${queue.paused ? "resume" : "pause"}`,
                      queue.paused
                        ? "Queue resumed."
                        : "Queue paused. Jobs wait until you resume it.",
                    )
                  }
                >
                  {queue.paused ? "Resume" : "Pause"}
                </Button>
                {queue.counts.failed > 0 && (
                  <Button
                    size="sm"
                    icon={<RefreshCw className="size-3.5" aria-hidden />}
                    onClick={() =>
                      void act(
                        `/system/queues/${selected}/retry-failed`,
                        "Failed jobs queued again.",
                      )
                    }
                  >
                    Retry all failed
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="size-3.5" aria-hidden />}
                  onClick={() => setConfirmClean(true)}
                >
                  Clean up
                </Button>
              </>
            )
          }
        />
        <CardBody className="flex flex-col gap-3">
          <Segmented
            label="Job state"
            size="sm"
            value={state}
            onChange={(value) => {
              setState(value);
              setPage(1);
            }}
            options={(["failed", "delayed", "waiting", "active", "completed"] as JobState[]).map(
              (value) => ({
                value,
                label: `${value === "delayed" ? "Scheduled" : value[0].toUpperCase() + value.slice(1)} (${queue?.counts[value] ?? 0})`,
              }),
            )}
          />
        </CardBody>
        {jobs.isLoading && !jobs.data && <TableSkeleton rows={3} label="Loading jobs" />}
        {jobs.data?.data.length === 0 && (
          <p className="px-4 pb-5 text-muted">
            No {state === "delayed" ? "scheduled" : state} jobs in this queue.
          </p>
        )}
        {jobs.data && jobs.data.data.length > 0 && (
          <Table caption={`${state} jobs`}>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>{state === "delayed" ? "Runs at" : "Created"}</Th>
                <Th>Attempts</Th>
                <Th>{state === "failed" ? "Reason" : "Details"}</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {jobs.data.data.map((job) => (
                <Tr key={job.id}>
                  <Td className="min-w-48">
                    <span className="font-semibold">{job.name}</span>
                    <Sub>
                      <span className="font-mono">{job.id}</span>
                    </Sub>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {when(state === "delayed" ? job.runAt : job.createdAt)}
                  </Td>
                  <Td>
                    {job.attemptsMade} / {job.maxAttempts}
                  </Td>
                  <Td className="max-w-md text-[13px] [overflow-wrap:anywhere]">
                    {job.failedReason ??
                      Object.entries(job.data)
                        .filter(([k]) => k !== "automationKey")
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(" · ")}
                  </Td>
                  <Td align="right">
                    <span className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setDetail(job.id)}>
                        Details
                      </Button>
                      {canEdit && state === "failed" && (
                        <Button
                          size="sm"
                          onClick={() =>
                            void act(
                              `/system/queues/${selected}/jobs/${job.id}/retry`,
                              "Job queued again.",
                            )
                          }
                        >
                          Retry
                        </Button>
                      )}
                      {canEdit && state === "delayed" && (
                        <Button
                          size="sm"
                          onClick={() =>
                            void act(
                              `/system/queues/${selected}/jobs/${job.id}/promote`,
                              "Job will run now.",
                            )
                          }
                        >
                          Run now
                        </Button>
                      )}
                      {canEdit && state !== "active" && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() =>
                            void act(
                              `/system/queues/${selected}/jobs/${job.id}/remove`,
                              "Job removed.",
                            )
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {jobs.data && jobs.data.meta.total > jobs.data.meta.pageSize && (
          <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[12.5px] text-muted">
            Page {page} of {Math.ceil(jobs.data.meta.total / jobs.data.meta.pageSize)}
            <span className="ml-auto flex gap-2">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                size="sm"
                disabled={page * jobs.data.meta.pageSize >= jobs.data.meta.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </span>
          </div>
        )}
      </Card>

      <JobDrawer queue={selected} jobId={detail} onClose={() => setDetail(null)} />
      <Dialog
        open={confirmClean}
        onClose={() => setConfirmClean(false)}
        title={`Clean up ${queue?.label ?? ""}?`}
        description="Removes finished jobs older than 1 day from this queue. Automation history and the audit log are not affected."
        footer={
          <>
            <Button onClick={() => setConfirmClean(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmClean(false);
                void act(`/system/queues/${selected}/clean`, "Finished jobs removed.", {
                  state: "completed",
                  olderThanDays: 1,
                });
              }}
            >
              Remove finished jobs
            </Button>
          </>
        }
      />
    </div>
  );
}

function JobDrawer({
  queue,
  jobId,
  onClose,
}: {
  queue: string;
  jobId: string | null;
  onClose: () => void;
}) {
  const { data, error } = useSWR<JobInfo>(
    jobId ? `/system/queues/${queue}/jobs/${jobId}` : null,
    fetcher,
  );
  return (
    <Drawer
      open={jobId !== null}
      onClose={onClose}
      title={data?.name ?? "Job"}
      description={jobId ?? undefined}
    >
      {error && (
        <ErrorState
          title="Couldn't load this job"
          description={error instanceof ApiError ? error.message : undefined}
        />
      )}
      {data && (
        <div className="flex flex-col gap-4 text-[13px]">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-muted">State</dt>
            <dd className="m-0 font-semibold">{data.state}</dd>
            <dt className="text-muted">Created</dt>
            <dd className="m-0">{when(data.createdAt)}</dd>
            {data.runAt && (
              <>
                <dt className="text-muted">Runs at</dt>
                <dd className="m-0">{when(data.runAt)}</dd>
              </>
            )}
            <dt className="text-muted">Started</dt>
            <dd className="m-0">{when(data.processedAt)}</dd>
            <dt className="text-muted">Finished</dt>
            <dd className="m-0">{when(data.finishedAt)}</dd>
            <dt className="text-muted">Attempts</dt>
            <dd className="m-0">
              {data.attemptsMade} / {data.maxAttempts}
            </dd>
          </dl>
          <section>
            <h3 className="mb-1.5 font-semibold">Data</h3>
            <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">
              {JSON.stringify(data.data, null, 2)}
            </pre>
          </section>
          {data.failedReason && (
            <section>
              <h3 className="mb-1.5 font-semibold text-bad">Why it failed</h3>
              <p className="[overflow-wrap:anywhere]">{data.failedReason}</p>
            </section>
          )}
          <section>
            <h3 className="mb-1.5 font-semibold">Log</h3>
            {data.logs?.length ? (
              <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap">
                {data.logs.join("\n")}
              </pre>
            ) : (
              <p className="text-muted">No log lines.</p>
            )}
          </section>
          {!!data.stacktrace?.length && (
            <section>
              <h3 className="mb-1.5 font-semibold">Error trace</h3>
              <pre className="max-h-64 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px]">
                {data.stacktrace.join("\n\n")}
              </pre>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

interface RequestRow {
  id: string;
  connection: { name: string } | null;
  channel: "REST" | "DB";
  method: string;
  target: string;
  doctype: string | null;
  httpStatus: number | null;
  ok: boolean;
  latencyMs: number;
  error: string | null;
  createdAt: string;
}

function RequestsTab() {
  const [failedOnly, setFailedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const { data, error, isLoading, mutate } = useSWR<Page<RequestRow>>(
    `/system/erp-requests?failedOnly=${failedOnly}&page=${page}`,
    fetcher,
    POLL,
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Segmented
          label="Which requests"
          size="sm"
          value={failedOnly ? "failed" : "all"}
          onChange={(value) => {
            setFailedOnly(value === "failed");
            setPage(1);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "failed", label: "Failures only" },
          ]}
        />
        <span className="text-xs text-muted">
          Kept for 30 days. Request bodies and credentials are never stored.
        </span>
      </div>
      {isLoading && !data && <TableSkeleton rows={4} label="Loading ERP requests" />}
      {error && !data && (
        <ErrorState title="Couldn't load ERP requests" onRetry={() => void mutate()} />
      )}
      {data?.data.length === 0 && (
        <p className="px-4 py-6 text-muted">
          {failedOnly ? "No failed ERP requests." : "No ERP requests yet."}
        </p>
      )}
      {data && data.data.length > 0 && (
        <Table caption="ERP requests">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Connection</Th>
              <Th>Call</Th>
              <Th>Result</Th>
              <Th align="right">Time</Th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((row) => (
              <Tr key={row.id}>
                <Td className="whitespace-nowrap text-muted">{when(row.createdAt)}</Td>
                <Td className="whitespace-nowrap">
                  {row.connection?.name ?? <span className="text-muted">Test (unsaved)</span>}
                </Td>
                <Td className="min-w-64">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Tag>{row.channel}</Tag>
                    <span className="font-mono text-xs">
                      {row.method} {row.target}
                    </span>
                  </span>
                  {row.doctype && <Sub>{row.doctype}</Sub>}
                </Td>
                <Td className="max-w-md">
                  <StatusPill tone={row.ok ? "ok" : "bad"}>
                    {row.ok
                      ? `OK${row.httpStatus ? ` ${row.httpStatus}` : ""}`
                      : `Failed${row.httpStatus ? ` ${row.httpStatus}` : ""}`}
                  </StatusPill>
                  {row.error && <Sub>{row.error}</Sub>}
                </Td>
                <Td align="right" className="whitespace-nowrap">
                  {row.latencyMs} ms
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {data && data.meta.total > data.meta.pageSize && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[12.5px] text-muted">
          {data.meta.total.toLocaleString()} requests
          <span className="ml-auto flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Newer
            </Button>
            <Button
              size="sm"
              disabled={page * data.meta.pageSize >= data.meta.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Older
            </Button>
          </span>
        </div>
      )}
    </Card>
  );
}

interface ConnectionHealth {
  id: string;
  name: string;
  baseUrl: string;
  status: string;
  consecutiveFailures: number;
  lastTestedAt: string | null;
  last24h: { requests: number; failed: number; avgLatencyMs: number };
  nextRecoveryCheckAt: string | null;
}

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "ok",
  UNTESTED: "warn",
  FAILING: "bad",
  DISABLED: "done",
  KEY_ERROR: "bad",
};

function ConnectionsTab() {
  const { data, isLoading, error, mutate } = useSWR<ConnectionHealth[]>(
    "/system/connections",
    fetcher,
    POLL,
  );
  if (isLoading && !data) return <TableSkeleton rows={2} label="Loading connections" />;
  if (error && !data)
    return <ErrorState title="Couldn't load connection health" onRetry={() => void mutate()} />;
  if (!data?.length)
    return (
      <p className="text-muted">
        No ERP connections yet. Add one under Settings → ERP connections.
      </p>
    );
  return (
    <Card>
      <Table caption="Connection health">
        <thead>
          <tr>
            <Th>Connection</Th>
            <Th>Status</Th>
            <Th align="right">Calls (24 h)</Th>
            <Th align="right">Failed</Th>
            <Th align="right">Avg time</Th>
            <Th>Next automatic re-test</Th>
          </tr>
        </thead>
        <tbody>
          {data.map((c) => (
            <Tr key={c.id}>
              <Td className="min-w-56">
                <span className="font-semibold">{c.name}</span>
                <Sub>
                  <span className="font-mono">{c.baseUrl}</span>
                </Sub>
              </Td>
              <Td>
                <StatusPill tone={STATUS_TONE[c.status] ?? "neutral"}>
                  {c.status.toLowerCase().replace("_", " ")}
                </StatusPill>
              </Td>
              <Td align="right">{c.last24h.requests}</Td>
              <Td align="right" className={c.last24h.failed ? "font-semibold text-bad" : ""}>
                {c.last24h.failed}
              </Td>
              <Td align="right">{c.last24h.avgLatencyMs} ms</Td>
              <Td className="whitespace-nowrap">
                {c.nextRecoveryCheckAt ? (
                  when(c.nextRecoveryCheckAt)
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

interface WebhookEvent {
  id: string;
  connection: { name: string } | null;
  doctype: string | null;
  docName: string | null;
  event: string | null;
  signatureValid: boolean;
  status: "QUEUED" | "PROCESSED" | "IGNORED" | "REJECTED" | "FAILED";
  detail: string | null;
  receivedAt: string;
}

const WEBHOOK_TONE: Record<WebhookEvent["status"], Tone> = {
  QUEUED: "prog",
  PROCESSED: "ok",
  IGNORED: "done",
  REJECTED: "bad",
  FAILED: "bad",
};

function WebhooksTab() {
  const canEdit = useSession().can("system.edit");
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, isLoading, mutate } = useSWR<Page<WebhookEvent>>(
    `/system/webhooks?page=${page}${status ? `&status=${status}` : ""}`,
    fetcher,
    POLL,
  );

  const reprocess = async (id: string) => {
    try {
      await apiFetch(`/system/webhooks/${id}/reprocess`, { method: "POST" });
      toast.success("Queued again.");
      await mutate();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Segmented
          label="Webhook status"
          size="sm"
          value={status || "all"}
          onChange={(value) => {
            setStatus(value === "all" ? "" : value);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "FAILED", label: "Failed" },
            { value: "REJECTED", label: "Rejected" },
            { value: "IGNORED", label: "Ignored" },
          ]}
        />
        <span className="text-xs text-muted">
          Every webhook ERPNext sent. Unsigned ones are rejected.
        </span>
      </div>
      {isLoading && !data && <TableSkeleton rows={3} label="Loading webhooks" />}
      {error && !data && (
        <ErrorState title="Couldn't load webhooks" onRetry={() => void mutate()} />
      )}
      {data?.data.length === 0 && <p className="px-4 py-6 text-muted">No webhooks received yet.</p>}
      {data && data.data.length > 0 && (
        <Table caption="Webhooks received">
          <thead>
            <tr>
              <Th>Received</Th>
              <Th>Record</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((row) => (
              <Tr key={row.id}>
                <Td className="whitespace-nowrap text-muted">{when(row.receivedAt)}</Td>
                <Td className="min-w-56">
                  <span className="font-semibold">
                    {row.doctype ?? "Unknown"} {row.docName ?? ""}
                  </span>
                  <Sub>
                    {row.connection?.name ?? "—"} · {row.event ?? "on_update"}
                  </Sub>
                </Td>
                <Td className="max-w-md">
                  <StatusPill tone={WEBHOOK_TONE[row.status]}>
                    {row.status.toLowerCase()}
                  </StatusPill>
                  {row.detail && <Sub>{row.detail}</Sub>}
                </Td>
                <Td align="right">
                  {canEdit &&
                    (row.status === "FAILED" || row.status === "IGNORED") &&
                    row.signatureValid &&
                    row.doctype && (
                      <Button size="sm" onClick={() => void reprocess(row.id)}>
                        Process again
                      </Button>
                    )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {data && data.meta.total > data.meta.pageSize && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[12.5px] text-muted">
          {data.meta.total.toLocaleString()} webhooks
          <span className="ml-auto flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Newer
            </Button>
            <Button
              size="sm"
              disabled={page * data.meta.pageSize >= data.meta.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Older
            </Button>
          </span>
        </div>
      )}
    </Card>
  );
}
