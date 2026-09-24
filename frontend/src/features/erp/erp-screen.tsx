"use client";

import { Database, FlaskConical, Lock, MoreHorizontal, Plus, Power, PowerOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { StatusPill, Tag, type Tone } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { Popover } from "@/components/ui/popover";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useStepUp } from "@/features/auth/use-step-up";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import {
  type Connection,
  type ConnectionInput,
  type ConnectionStatus,
  erpApi,
  type ErpPurpose,
  PURPOSE_HELP,
  type PurposesResponse,
} from "./api";
import { ConnectionDrawer } from "./connection-drawer";
import { TestResultView } from "./test-result-view";

const STATUS: Record<ConnectionStatus, { label: string; tone: Tone; help: string }> = {
  UNTESTED: {
    label: "Needs a test",
    tone: "warn",
    help: "Test it to check access, then enable it.",
  },
  ACTIVE: { label: "Active", tone: "ok", help: "In use." },
  FAILING: {
    label: "Failing",
    tone: "bad",
    help: "The last test failed. Check the details and test again.",
  },
  DISABLED: { label: "Disabled", tone: "done", help: "Not used by anything until enabled." },
  KEY_ERROR: {
    label: "Key error",
    tone: "bad",
    help: "Saved credentials can't be read with the current encryption key. Edit it and enter them again.",
  },
};

const fetcher = <T,>(key: string) => apiFetch<T>(key);

export function ErpScreen() {
  const { can, me } = useSession();
  const toast = useToast();
  const stepUp = useStepUp();
  const allowed = can("erp.manage");
  const connections = useSWR<Connection[]>(allowed ? "/erp/connections" : null, fetcher);
  const purposes = useSWR<PurposesResponse>(allowed ? "/erp/purposes" : null, fetcher);
  const [editing, setEditing] = useState<Connection | "new" | null>(null);
  const [deleting, setDeleting] = useState<Connection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = () => Promise.all([connections.mutate(), purposes.mutate()]);

  const fail = (caught: unknown) => {
    if (caught instanceof ApiError && caught.code === "STEP_UP_CANCELLED") return;
    toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
  };

  const act = async (key: string, action: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await action();
      if (success) toast.success(success);
      await refresh();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  };

  const save = async (input: ConnectionInput, useDb: boolean) => {
    if (editing === "new") {
      const created = await stepUp.run(() => erpApi.create(input));
      toast.success(`“${created.name}” was saved. Test it next.`);
    } else if (editing) {
      await stepUp.run(() =>
        erpApi.update(editing.id, {
          name: input.name,
          baseUrl: input.baseUrl,
          apiKey: input.apiKey || undefined,
          apiSecret: input.apiSecret || undefined,
          db: useDb ? input.db : editing.db ? null : undefined,
          version: editing.version,
        }),
      );
      toast.success("Changes saved.");
    }
    setEditing(null);
    await refresh();
  };

  const test = async (connection: Connection) => {
    setBusy(`test:${connection.id}`);
    try {
      const updated = await erpApi.test(connection.id);
      setExpanded(connection.id);
      if (updated.lastTestResult?.ok) toast.success(`“${connection.name}” works.`);
      else toast.error(`The test of “${connection.name}” failed. See the details below it.`);
      await refresh();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  };

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="ERP connections" />
        <Card>
          <EmptyState
            icon={<Lock className="size-6" />}
            title="You don't have access to this"
            description="Only administrators can manage ERP connections."
          />
        </Card>
      </>
    );
  }

  const list = connections.data ?? [];

  return (
    <>
      <PageHeader
        title="ERP connections"
        description="Connect ERPNext so ServiceBridge can read customers, machines, stock and business figures."
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => setEditing("new")}
          >
            Add connection
          </Button>
        }
      />

      {connections.isLoading && (
        <Card>
          <TableSkeleton rows={3} label="Loading connections" />
        </Card>
      )}
      {connections.error && !connections.data && (
        <Card>
          <ErrorState title="Couldn't load connections" onRetry={() => void refresh()} />
        </Card>
      )}
      {connections.data && list.length === 0 && (
        <Card>
          <EmptyState
            icon={<Database className="size-6" />}
            title="No ERP connected yet"
            description="Until you add one, ServiceBridge runs on its own sample data. You'll need an ERPNext address and an API key and secret."
            action={
              <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
                Add connection
              </Button>
            }
          />
        </Card>
      )}

      {list.map((connection) => {
        const status = STATUS[connection.status];
        const labels = purposes.data?.labels;
        return (
          <Card key={connection.id} aria-labelledby={`conn-${connection.id}`}>
            <div className="flex flex-wrap items-start gap-3 px-4 py-3.5">
              <span
                className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted"
                aria-hidden
              >
                <Database className="size-5" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id={`conn-${connection.id}`} className="text-[15px] font-semibold">
                    {connection.name}
                  </h2>
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  {connection.purposes.map((purpose) => (
                    <Tag key={purpose}>{labels?.[purpose] ?? purpose}</Tag>
                  ))}
                </div>
                <p className="font-mono text-xs break-all text-muted">{connection.baseUrl}</p>
                <p className="text-xs text-muted">
                  {[
                    connection.erpVersion && `ERPNext ${connection.erpVersion}`,
                    `API key ••••${connection.apiKeyHint}`,
                    connection.db
                      ? `Database ${connection.db.host}:${connection.db.port}, up to ${connection.db.connectionLimit} connections`
                      : "No database access",
                    connection.lastTestedAt
                      ? `Tested ${new Date(connection.lastTestedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
                      : "Never tested",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="text-xs text-muted">{status.help}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
                <Button
                  size="sm"
                  variant={
                    connection.status === "UNTESTED" || connection.status === "FAILING"
                      ? "strong"
                      : "secondary"
                  }
                  icon={<FlaskConical className="size-3.5" aria-hidden />}
                  loading={busy === `test:${connection.id}`}
                  disabled={connection.status === "KEY_ERROR"}
                  onClick={() => void test(connection)}
                >
                  Test
                </Button>
                {connection.canEnable && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Power className="size-3.5" aria-hidden />}
                    loading={busy === `enable:${connection.id}`}
                    onClick={() =>
                      void act(
                        `enable:${connection.id}`,
                        () => erpApi.enable(connection.id),
                        `“${connection.name}” is enabled.`,
                      )
                    }
                  >
                    Enable
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setEditing(connection)}>
                  Edit
                </Button>
                <Popover
                  className="w-56"
                  trigger={(props) => (
                    <IconButton label={`More actions for ${connection.name}`} size="sm" {...props}>
                      <MoreHorizontal className="size-4" aria-hidden />
                    </IconButton>
                  )}
                >
                  {(close) => (
                    <div className="flex flex-col py-1.5">
                      {connection.status !== "DISABLED" && (
                        <MenuItem
                          onClick={() => {
                            close();
                            void act(
                              `disable:${connection.id}`,
                              () => erpApi.disable(connection.id),
                              `“${connection.name}” is disabled.`,
                            );
                          }}
                        >
                          <PowerOff className="size-4" aria-hidden /> Disable
                        </MenuItem>
                      )}
                      <MenuItem
                        danger
                        onClick={() => {
                          close();
                          setDeleting(connection);
                        }}
                      >
                        Delete…
                      </MenuItem>
                    </div>
                  )}
                </Popover>
              </div>
            </div>
            {connection.lastTestResult && (
              <div className="border-t border-line px-4 py-3">
                <button
                  type="button"
                  aria-expanded={expanded === connection.id}
                  onClick={() => setExpanded((id) => (id === connection.id ? null : connection.id))}
                  className="cursor-pointer text-[13px] font-semibold text-text underline-offset-2 hover:underline"
                >
                  {expanded === connection.id ? "Hide last test result" : "Show last test result"}
                </button>
                {expanded === connection.id && (
                  <div className="mt-3">
                    <TestResultView result={connection.lastTestResult} />
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}

      {list.length > 0 && purposes.data && (
        <PurposesCard connections={list} data={purposes.data} onSaved={refresh} onError={fail} />
      )}

      <ConnectionDrawer
        open={editing !== null}
        connection={editing && editing !== "new" ? editing : undefined}
        onClose={() => setEditing(null)}
        onSave={save}
        onReveal={
          editing && editing !== "new"
            ? () => stepUp.run(() => erpApi.reveal(editing.id))
            : undefined
        }
      />

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name ?? ""}”?`}
        description="Its saved credentials are erased. ERPNext itself isn't changed."
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy === "delete"}
              onClick={() =>
                deleting &&
                void act(
                  "delete",
                  () => erpApi.remove(deleting.id),
                  `“${deleting.name}” was deleted.`,
                ).then(() => setDeleting(null))
              }
            >
              Delete
            </Button>
          </>
        }
      />
      {stepUp.dialog}
    </>
  );
}

function PurposesCard({
  connections,
  data,
  onSaved,
  onError,
}: {
  connections: Connection[];
  data: PurposesResponse;
  onSaved: () => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState(data.assignments);
  const [saving, setSaving] = useState(false);
  const active = connections.filter((c) => c.status === "ACTIVE");
  const changed = (Object.keys(draft) as ErpPurpose[]).some(
    (p) => draft[p] !== data.assignments[p],
  );

  const save = async () => {
    setSaving(true);
    try {
      const changes = Object.fromEntries(
        (Object.keys(draft) as ErpPurpose[])
          .filter((p) => draft[p] !== data.assignments[p])
          .map((p) => [p, draft[p]]),
      );
      await erpApi.setPurposes(changes);
      toast.success("Saved. ServiceBridge will use these connections.");
      await onSaved();
    } catch (caught) {
      onError(caught);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card aria-labelledby="purposes-title">
      <CardHeader
        titleId="purposes-title"
        title="What each connection is used for"
        meta="Only active connections can be chosen"
      />
      <CardBody className="flex flex-col gap-4">
        {(Object.keys(data.labels) as ErpPurpose[]).map((purpose) => (
          <Field key={purpose} label={data.labels[purpose]} help={PURPOSE_HELP[purpose]}>
            {(p) => (
              <Select
                {...p}
                value={draft[purpose] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [purpose]: e.target.value || null }))}
                className="sm:max-w-md"
              >
                <option value="">Not used</option>
                {connections
                  .filter((c) => c.status === "ACTIVE" || c.id === draft[purpose])
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        ))}
        {active.length === 0 && (
          <p className="text-[13px] text-muted">Test and enable a connection to choose it here.</p>
        )}
        <div>
          <Button variant="strong" loading={saving} disabled={!changed} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2 px-4 py-2.5 text-left hover:bg-surface-2 ${danger ? "text-bad" : "text-text"}`}
    >
      {children}
    </button>
  );
}
