"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  History,
  Plus,
  RefreshCw,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import useSWR from "swr";
import { StatusPill, Tag, type Tone } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { Table, Td, Th, Tr, Sub } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { useStepUp } from "@/features/auth/use-step-up";

/* ── Types (mirror the backend write-backs API) ─────────────────────────── */

export type WritebackType = "INVOICE" | "STOCK_ENTRY";
export type WritebackStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
export type InvoiceTrigger = "close" | "verify";

export interface WritebackSettings {
  invoiceTriggers: InvoiceTrigger[];
  defaultWarehouseId: string | null;
  stockEntryAsDraft: boolean;
  invoiceTaxTemplate: string | null;
}

export interface WritebackAutomation {
  key: "writeback-invoice" | "writeback-stock-entry";
  name: string;
  description: string;
  enabled: boolean;
}

export interface WritebackConnection {
  id: string;
  name: string;
  status: string;
}

export interface WritebackSetup {
  ok: boolean;
  readyForWriteback: boolean;
  missingFields: { doctype: string; fieldname: string }[];
  fieldInstructions: string;
}

export interface WritebackWarehouse {
  id: string;
  name: string;
  erpName: string;
  active: boolean;
  source: string;
}

export interface WritebackRow {
  id: string;
  type: WritebackType;
  status: WritebackStatus;
  ticketId: string;
  ticketNumber: string;
  visitId: string | null;
  erpDocType: string;
  erpDocName: string | null;
  attempts: number;
  error: string | null;
  createdAt: string;
}

export interface WritebackOverview {
  settings: WritebackSettings;
  automations: WritebackAutomation[];
  connection: WritebackConnection | null;
  setup: WritebackSetup;
  warehouses: WritebackWarehouse[];
  recent: WritebackRow[];
}

/* ── API ────────────────────────────────────────────────────────────────── */

export const writebackApi = {
  overview: () => apiFetch<WritebackOverview>("/erp/writebacks/overview"),
  updateSettings: (body: Partial<WritebackSettings>) =>
    apiFetch<WritebackSettings>("/erp/writebacks/settings", { method: "PATCH", json: body }),
  retry: (id: string) =>
    apiFetch<{ id: string; status: WritebackStatus }>(`/erp/writebacks/${id}/retry`, {
      method: "POST",
    }),
  addWarehouse: (name: string) =>
    apiFetch<WritebackWarehouse>("/erp/writebacks/warehouses", {
      method: "POST",
      json: { name },
    }),
  updateWarehouse: (id: string, body: { name?: string; active?: boolean }) =>
    apiFetch<WritebackWarehouse>(`/erp/writebacks/warehouses/${id}`, {
      method: "PATCH",
      json: body,
    }),
};

/* ── Labels ─────────────────────────────────────────────────────────────── */

export const WRITEBACK_STATUS: Record<WritebackStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "prog" },
  PROCESSING: { label: "Processing", tone: "prog" },
  SUCCEEDED: { label: "Succeeded", tone: "ok" },
  FAILED: { label: "Failed", tone: "bad" },
};

export const WRITEBACK_TYPE_LABEL: Record<WritebackType, string> = {
  INVOICE: "Invoice",
  STOCK_ENTRY: "Stock entry",
};

const INVOICE_TRIGGER_ORDER: InvoiceTrigger[] = ["close", "verify"];

export const INVOICE_TRIGGER_LABELS: Record<InvoiceTrigger, { label: string; help: string }> = {
  close: {
    label: "When a ticket is closed",
    help: "Raise a draft sales invoice in the ERP on ticket closure.",
  },
  verify: {
    label: "When a ticket is verified",
    help: "Raise a draft sales invoice in the ERP on ticket verification.",
  },
};

const CONNECTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  UNTESTED: { label: "Needs a test", tone: "warn" },
  ACTIVE: { label: "Active", tone: "ok" },
  FAILING: { label: "Failing", tone: "bad" },
  DISABLED: { label: "Disabled", tone: "done" },
  KEY_ERROR: { label: "Key error", tone: "bad" },
};

const WAREHOUSE_SOURCE_LABEL: Record<string, string> = {
  LOCAL: "Local",
  ERP: "Synced from ERP",
};

/** Only locally created warehouses can be renamed or deactivated. */
export const isLocalWarehouse = (warehouse: WritebackWarehouse) =>
  warehouse.source === "LOCAL";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const fetcher = <T,>(key: string) => apiFetch<T>(key);

/* ── Section ────────────────────────────────────────────────────────────── */

export function WritebacksSection() {
  const { can } = useSession();
  const canEdit = can("writebacks.edit");
  const toast = useToast();
  const stepUp = useStepUp();
  const { data, error, isLoading, mutate } = useSWR<WritebackOverview>(
    "/erp/writebacks/overview",
    fetcher,
    { refreshInterval: 15_000 },
  );

  const refresh = () => mutate();

  const fail = (caught: unknown) => {
    if (caught instanceof ApiError && caught.code === "STEP_UP_CANCELLED") return;
    toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
  };

  return (
    <>
      <div className="flex flex-col gap-1 pt-2">
        <h2 className="text-lg font-semibold tracking-tight">Write-backs</h2>
        <p className="max-w-[80ch] text-[13px] text-muted">
          Draft sales invoices and stock entries posted to the ERP. Nothing is posted until the
          readiness checks pass and each automation is switched on.
        </p>
      </div>

      {isLoading && (
        <Card>
          <TableSkeleton rows={4} label="Loading write-backs" />
        </Card>
      )}
      {error && !data && (
        <Card>
          <ErrorState
            title="Couldn't load write-backs"
            description={error instanceof ApiError ? error.message : undefined}
            onRetry={() => void refresh()}
          />
        </Card>
      )}

      {data && (
        <>
          <SetupCard overview={data} />
          <SettingsCard
            settings={data.settings}
            warehouses={data.warehouses}
            setupOk={data.setup.ok}
            readOnly={!canEdit}
            stepUpRun={stepUp.run}
            onSaved={() => void refresh()}
            onError={fail}
          />
          <WarehousesCard
            warehouses={data.warehouses}
            canEdit={canEdit}
            onChanged={() => void refresh()}
          />
          <AutomationsCard automations={data.automations} />
          <RecentCard
            rows={data.recent}
            canEdit={canEdit}
            onChanged={() => void refresh()}
            onError={fail}
          />
        </>
      )}
      {stepUp.dialog}
    </>
  );
}

/* ── 1. Setup check ─────────────────────────────────────────────────────── */

function SetupCard({ overview }: { overview: WritebackOverview }) {
  const { connection, setup } = overview;
  const [copied, setCopied] = useState(false);
  const connStatus = connection ? CONNECTION_STATUS[connection.status] : null;

  return (
    <Card aria-labelledby="writeback-setup-title">
      <CardHeader titleId="writeback-setup-title" title="Write-back readiness" />
      <CardBody className="flex flex-col gap-4">
        {!connection && (
          <Banner>
            <p className="font-semibold">No ERP connection available for write-backs</p>
            <p className="mt-0.5 text-[13px] text-text">
              Add a connection above, test it, then choose it for “Write-backs” under “What each
              connection is used for”.
            </p>
          </Banner>
        )}

        {connection && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">{connection.name}</span>
            {connStatus && <StatusPill tone={connStatus.tone}>{connStatus.label}</StatusPill>}
            {setup.readyForWriteback ? (
              <StatusPill tone="ok">Ready for write-backs</StatusPill>
            ) : (
              <StatusPill tone="warn">Not ready</StatusPill>
            )}
          </div>
        )}

        {!setup.ok && connection && (
          <Banner role="status">
            <p className="font-semibold">Write-backs are disabled</p>
            <p className="mt-0.5 text-[13px] text-text">
              They stay off until the checks below pass. Nothing will be posted to the ERP in the
              meantime.
            </p>
          </Banner>
        )}

        {setup.ok && connection && (
          <p className="flex items-start gap-2 text-[13px] text-muted">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
            The connection is ready. Draft invoices and stock entries can be posted once their
            automations are switched on.
          </p>
        )}

        {setup.missingFields.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <h3 className="text-[13px] font-semibold">Missing ERP fields</h3>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
              {setup.missingFields.map((field) => (
                <li key={`${field.doctype}:${field.fieldname}`} className="flex flex-wrap items-center gap-2">
                  <Tag className="font-mono">{field.fieldname}</Tag>
                  <span className="text-muted">on {field.doctype}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">Add them in ERPNext</p>
                <Button
                  size="sm"
                  icon={<Copy className="size-3.5" aria-hidden />}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(setup.fieldInstructions)
                      .then(
                        () => setCopied(true),
                        () => undefined,
                      )
                  }
                >
                  {copied ? "Copied" : "Copy steps"}
                </Button>
              </div>
              <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap text-text">
                {setup.fieldInstructions}
              </pre>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Banner({ role, children }: { role?: "status"; children: ReactNode }) {
  return (
    <div
      role={role}
      className="flex items-start gap-2.5 rounded-lg bg-warn-bg px-3.5 py-3 text-warn"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ── 2. Settings form ───────────────────────────────────────────────────── */

function SettingsCard({
  settings,
  warehouses,
  setupOk,
  readOnly,
  stepUpRun,
  onSaved,
  onError,
}: {
  settings: WritebackSettings;
  warehouses: WritebackWarehouse[];
  setupOk: boolean;
  readOnly: boolean;
  stepUpRun: <T>(action: () => Promise<T>) => Promise<T>;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<WritebackSettings>(settings);
  const [saving, setSaving] = useState(false);
  const disabled = readOnly || !setupOk;

  const toggleTrigger = (trigger: InvoiceTrigger, on: boolean) => {
    const next = new Set(draft.invoiceTriggers);
    if (on) next.add(trigger);
    else next.delete(trigger);
    setDraft((d) => ({
      ...d,
      invoiceTriggers: INVOICE_TRIGGER_ORDER.filter((t) => next.has(t)),
    }));
  };

  const diff: Partial<WritebackSettings> = {};
  if (JSON.stringify(draft.invoiceTriggers) !== JSON.stringify(settings.invoiceTriggers))
    diff.invoiceTriggers = draft.invoiceTriggers;
  if (draft.defaultWarehouseId !== settings.defaultWarehouseId)
    diff.defaultWarehouseId = draft.defaultWarehouseId;
  if (draft.stockEntryAsDraft !== settings.stockEntryAsDraft)
    diff.stockEntryAsDraft = draft.stockEntryAsDraft;
  if ((draft.invoiceTaxTemplate ?? "") !== (settings.invoiceTaxTemplate ?? ""))
    diff.invoiceTaxTemplate = draft.invoiceTaxTemplate?.trim() || null;
  const changed = Object.keys(diff).length > 0;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!changed || disabled) return;
    setSaving(true);
    try {
      await stepUpRun(() => writebackApi.updateSettings(diff));
      toast.success("Write-back settings saved.");
      onSaved();
    } catch (caught) {
      onError(caught);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card aria-labelledby="writeback-settings-title">
      <CardHeader
        titleId="writeback-settings-title"
        title="Write-back settings"
        meta={readOnly ? undefined : "Saving asks for your password"}
      />
      <CardBody>
        <form onSubmit={save} noValidate>
          <fieldset disabled={disabled} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span id="trigger-legend" className="text-[13px] font-semibold">
                Create draft sales invoices
              </span>
              <div
                role="group"
                aria-labelledby="trigger-legend"
                className="flex flex-col gap-2.5"
              >
                {INVOICE_TRIGGER_ORDER.map((trigger) => (
                  <label
                    key={trigger}
                    className="flex cursor-pointer items-start gap-2.5 text-[13px]"
                  >
                    <input
                      type="checkbox"
                      checked={draft.invoiceTriggers.includes(trigger)}
                      onChange={(e) => toggleTrigger(trigger, e.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-[var(--accent-strong)]"
                    />
                    <span>
                      {INVOICE_TRIGGER_LABELS[trigger].label}
                      <span className="block text-muted">
                        {INVOICE_TRIGGER_LABELS[trigger].help}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted">
                Invoices are always drafts in the ERP — they are never auto-submitted.
              </p>
            </div>

            <Field
              label="Default warehouse"
              help="Stock entries issue consumed spares from this warehouse."
              className="sm:max-w-md"
            >
              {(p) => (
                <Select
                  {...p}
                  value={draft.defaultWarehouseId ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, defaultWarehouseId: e.target.value || null }))
                  }
                >
                  <option value="">No default warehouse</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                      {w.active ? "" : " (inactive)"}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
              <input
                type="checkbox"
                checked={draft.stockEntryAsDraft}
                onChange={(e) => setDraft((d) => ({ ...d, stockEntryAsDraft: e.target.checked }))}
                className="mt-0.5 size-4 shrink-0 accent-[var(--accent-strong)]"
              />
              <span>
                Save stock entries as drafts
                <span className="block text-muted">
                  When off, stock entries are submitted in the ERP straight away.
                </span>
              </span>
            </label>

            <Field
              label="Invoice tax template"
              help="Optional. The name of a tax template in the ERP applied to draft invoices."
              className="sm:max-w-md"
            >
              {(p) => (
                <Input
                  {...p}
                  value={draft.invoiceTaxTemplate ?? ""}
                  placeholder="Leave empty for no tax"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, invoiceTaxTemplate: e.target.value }))
                  }
                  spellCheck={false}
                />
              )}
            </Field>

            {!readOnly && (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="strong" loading={saving} disabled={!changed}>
                  Save settings
                </Button>
                {!setupOk && (
                  <p className="text-xs text-muted">
                    Complete the readiness checks above to change these settings.
                  </p>
                )}
              </div>
            )}
          </fieldset>
        </form>
      </CardBody>
    </Card>
  );
}

/* ── 3. Warehouses ──────────────────────────────────────────────────────── */

function WarehousesCard({
  warehouses,
  canEdit,
  onChanged,
}: {
  warehouses: WritebackWarehouse[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string>();
  const [editing, setEditing] = useState<WritebackWarehouse | null>(null);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setAddError("Give the warehouse a name.");
      return;
    }
    setAdding(true);
    setAddError(undefined);
    try {
      await writebackApi.addWarehouse(trimmed);
      toast.success(`“${trimmed}” was added.`);
      setName("");
      onChanged();
    } catch (caught) {
      setAddError(
        caught instanceof ApiError ? caught.message : "Something went wrong. Try again.",
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <Card aria-labelledby="writeback-warehouses-title">
      <CardHeader
        titleId="writeback-warehouses-title"
        title="Warehouses"
        meta="Stock entries issue spares from these"
      />
      {warehouses.length === 0 ? (
        <EmptyState
          icon={<WarehouseIcon className="size-6" />}
          title="No warehouses yet"
          description="Add the stores your field engineers draw spares from."
        />
      ) : (
        <Table caption="Warehouses used for write-backs">
          <thead>
            <Tr>
              <Th>Name</Th>
              <Th>Source</Th>
              <Th>Status</Th>
              {canEdit && <Th align="right">Actions</Th>}
            </Tr>
          </thead>
          <tbody>
            {warehouses.map((warehouse) => (
              <Tr key={warehouse.id}>
                <Td>
                  <span className="font-medium">{warehouse.name}</span>
                  {warehouse.erpName && warehouse.erpName !== warehouse.name && (
                    <Sub>ERP name: {warehouse.erpName}</Sub>
                  )}
                </Td>
                <Td>
                  <Tag>{WAREHOUSE_SOURCE_LABEL[warehouse.source] ?? warehouse.source}</Tag>
                </Td>
                <Td>
                  <StatusPill tone={warehouse.active ? "ok" : "done"}>
                    {warehouse.active ? "Active" : "Inactive"}
                  </StatusPill>
                </Td>
                {canEdit && (
                  <Td align="right">
                    {isLocalWarehouse(warehouse) ? (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(warehouse)}>
                        Edit
                      </Button>
                    ) : (
                      <span className="text-xs text-muted">Read-only</span>
                    )}
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {canEdit && (
        <div className="border-t border-line px-4 py-3.5">
          <form onSubmit={add} noValidate className="flex flex-col gap-2">
            <Field label="Add a warehouse" error={addError} className="sm:max-w-md">
              {(p) => (
                <div className="flex gap-2">
                  <Input
                    {...p}
                    value={name}
                    placeholder="e.g. North service store"
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Button type="submit" loading={adding} icon={<Plus className="size-4" aria-hidden />}>
                    Add
                  </Button>
                </div>
              )}
            </Field>
          </form>
        </div>
      )}
      {editing && (
        <WarehouseDialog
          key={editing.id}
          warehouse={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function WarehouseDialog({
  warehouse,
  onClose,
  onSaved,
}: {
  warehouse: WritebackWarehouse;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(warehouse.name);
  const [active, setActive] = useState(warehouse.active);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const changed = name.trim() !== warehouse.name || active !== warehouse.active;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the warehouse a name.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await writebackApi.updateWarehouse(warehouse.id, { name: trimmed, active });
      toast.success("Warehouse saved.");
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === "WAREHOUSE_SYNCED"
          ? "This warehouse is synced from the ERP and can't be changed here."
          : caught instanceof ApiError
            ? caught.message
            : "Something went wrong. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dirty={changed}
      title={`Edit “${warehouse.name}”`}
      description="Only warehouses created here can be changed. ERP-synced warehouses are read-only."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form="warehouse-form"
            variant="strong"
            loading={saving}
            disabled={!changed}
          >
            Save
          </Button>
        </>
      }
    >
      <form
        id="warehouse-form"
        key={warehouse.id}
        onSubmit={save}
        noValidate
        className="flex flex-col gap-4"
      >
        <Field label="Name" required error={error}>
          {(p) => (
            <Input
              {...p}
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
            />
          )}
        </Field>
        <div className="flex items-center gap-3">
          <Switch
            label={`Warehouse “${warehouse.name}” active`}
            checked={active}
            onChange={setActive}
          />
          <span className="text-[13px]">{active ? "Active" : "Inactive"}</span>
        </div>
      </form>
    </Dialog>
  );
}

/* ── 4. Automations ─────────────────────────────────────────────────────── */

function AutomationsCard({ automations }: { automations: WritebackAutomation[] }) {
  return (
    <Card aria-labelledby="writeback-automations-title">
      <CardHeader
        titleId="writeback-automations-title"
        title="Automations"
        meta="Each write-back has its own on/off switch"
        actions={
          <ButtonLink href="/settings/automations" variant="ghost" size="sm">
            Open Automations
          </ButtonLink>
        }
      />
      {automations.length === 0 ? (
        <EmptyState
          icon={<History className="size-6" />}
          title="No write-back automations"
          description="The invoice and stock-entry automations will appear here once configured."
        />
      ) : (
        <ul className="m-0 list-none p-0">
          {automations.map((automation) => (
            <li
              key={automation.key}
              className="flex flex-wrap items-start gap-4 border-b border-line px-4 py-4 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {automation.name}
                  <StatusPill tone={automation.enabled ? "ok" : "done"}>
                    {automation.enabled ? "On" : "Off"}
                  </StatusPill>
                </p>
                <p className="max-w-[75ch] text-[13px] text-muted">{automation.description}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ── 5. Recent write-backs ──────────────────────────────────────────────── */

function RecentCard({
  rows,
  canEdit,
  onChanged,
  onError,
}: {
  rows: WritebackRow[];
  canEdit: boolean;
  onChanged: () => void;
  onError: (error: unknown) => void;
}) {
  const toast = useToast();
  const [retrying, setRetrying] = useState<string | null>(null);

  const retry = async (row: WritebackRow) => {
    setRetrying(row.id);
    try {
      await writebackApi.retry(row.id);
      toast.success(`Write-back for ${row.ticketNumber} was queued for retry.`);
      onChanged();
    } catch (caught) {
      onError(caught);
    } finally {
      setRetrying(null);
    }
  };

  return (
    <Card aria-labelledby="writeback-recent-title">
      <CardHeader titleId="writeback-recent-title" title="Recent write-backs" meta="Latest first" />
      {rows.length === 0 ? (
        <EmptyState
          icon={<History className="size-6" />}
          title="No write-backs yet"
          description="Invoices and stock entries posted to the ERP will appear here."
        />
      ) : (
        <Table caption="Recent ERP write-backs">
          <thead>
            <Tr>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th>Ticket</Th>
              <Th>ERP document</Th>
              <Th align="right">Attempts</Th>
              <Th>Error</Th>
              <Th>Created</Th>
              {canEdit && <Th align="right">Actions</Th>}
            </Tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const status = WRITEBACK_STATUS[row.status];
              return (
                <Tr key={row.id}>
                  <Td>{WRITEBACK_TYPE_LABEL[row.type]}</Td>
                  <Td>
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  </Td>
                  <Td>
                    <Link
                      href={`/tickets/${row.ticketNumber}`}
                      className="font-medium text-accent-ink underline-offset-2 hover:underline"
                    >
                      {row.ticketNumber}
                    </Link>
                  </Td>
                  <Td>
                    {row.erpDocName ? (
                      <>
                        <span className="font-mono text-xs">{row.erpDocName}</span>
                        <Sub>{row.erpDocType}</Sub>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td align="right">{row.attempts}</Td>
                  <Td>
                    {row.error ? (
                      <span className="block max-w-64 text-xs text-bad [overflow-wrap:anywhere]">
                        {row.error}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{when(row.createdAt)}</Td>
                  {canEdit && (
                    <Td align="right">
                      {row.status === "FAILED" && (
                        <Button
                          size="sm"
                          loading={retrying === row.id}
                          icon={<RefreshCw className="size-3.5" aria-hidden />}
                          onClick={() => void retry(row)}
                        >
                          Retry
                        </Button>
                      )}
                    </Td>
                  )}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
