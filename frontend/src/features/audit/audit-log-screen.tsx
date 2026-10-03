"use client";

import { History, ShieldCheck, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { StatusPill, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Dialog } from "@/components/ui/dialog";
import { Pager, SearchInput } from "@/components/ui/list-controls";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession, type Permission } from "@/lib/auth/session";
import { useStepUp } from "@/features/auth/use-step-up";
import { formatDate } from "@/features/catalog/shared";

/* ── Types (mirror the backend audit API) ─────────────────────────────────── */

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  changes: unknown;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
  /** The signed-in user who made the change; null for partner keys and the system. */
  actor: { id: string; name: string } | null;
  /** Set when the change came through the partner API. */
  partnerKey: { id: string; name: string } | null;
}

export interface AuditPage {
  rows: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

const AUDIT_READ: Permission = "audit.read";
const AUDIT_EDIT: Permission = "audit.edit";

const ACTION_GROUPS: { value: string; label: string }[] = [
  { value: "ticket.", label: "Tickets" },
  { value: "partner.", label: "Partner API" },
  { value: "import.", label: "Bulk imports" },
  { value: "audit.", label: "Audit log admin" },
  { value: "user.", label: "Users" },
  { value: "role.", label: "Roles" },
  { value: "erp.", label: "ERP" },
  { value: "automation.", label: "Automations" },
];

export function actorTone(
  entry: Pick<AuditEntry, "actor" | "partnerKey">,
): { label: string; tone: Tone } {
  if (entry.partnerKey) return { label: `Key: ${entry.partnerKey.name}`, tone: "info" };
  if (entry.actor) return { label: entry.actor.name, tone: "neutral" };
  return { label: "System", tone: "neutral" };
}

/** Short, readable summary of a changes payload. Pure — unit tested. */
export function summarizeChanges(changes: unknown): string {
  if (changes == null) return "—";
  if (typeof changes === "string") return changes;
  if (typeof changes !== "object") return String(changes);
  const keys = Object.keys(changes as Record<string, unknown>);
  if (keys.length === 0) return "—";
  return keys.slice(0, 4).join(", ") + (keys.length > 4 ? ` (+${keys.length - 4} more)` : "");
}

export function AuditLogScreen() {
  const { can } = useSession();
  const stepUp = useStepUp();
  const canEdit = can(AUDIT_EDIT);

  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);

  const params = new URLSearchParams();
  if (action) params.set("action", action);
  if (entityType) params.set("entityType", entityType);
  if (search) params.set("search", search);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  params.set("page", String(page));
  const key = can(AUDIT_READ) ? `/audit-log?${params.toString()}` : null;
  const { data, error, isLoading, mutate } = useSWR(key, (k: string) => apiFetch<AuditPage>(k));

  const { data: retention } = useSWR(
    canEdit ? "/audit-log/retention" : null,
    (k: string) => apiFetch<{ retentionDays: number }>(k),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Every change in ERPTick, in order. Entries can never be edited or deleted — only purged past the retention window by an administrator."
        actions={
          canEdit ? (
            <>
              <Button variant="secondary" onClick={() => setRetentionOpen(true)}>
                <ShieldCheck className="size-4" aria-hidden /> Retention
              </Button>
              <Button variant="danger" onClick={() => setPurgeOpen(true)}>
                <Trash2 className="size-4" aria-hidden /> Purge old entries
              </Button>
            </>
          ) : undefined
        }
      />

      {canEdit && retention && (
        <Card>
          <CardBody>
            <p className="text-sm text-muted">
              Entries older than <strong className="text-text">{retention.retentionDays} days</strong>{" "}
              are eligible for purging. Purging keeps the newest 1,000 matching rows and records
              itself in the log.
            </p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Entries" />
        <CardBody>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-5">
            <Select aria-label="Action prefix" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
              <option value="">All actions</option>
              {ACTION_GROUPS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </Select>
            <Input
              aria-label="Entity type"
              placeholder="Entity type, e.g. Ticket"
              value={entityType}
              onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
            />
            <Input
              aria-label="From date"
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            />
            <Input
              aria-label="To date"
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); setPage(1); }}
            />
            <SearchInput
              label="Search"
              initial={search}
              onChange={(v) => { setSearch(v); setPage(1); }}
              placeholder="Search action or summary…"
            />
          </div>

          {isLoading ? (
            <TableSkeleton rows={8} />
          ) : error ? (
            <ErrorState title="Could not load the audit log." onRetry={() => void mutate()} />
          ) : !data?.rows.length ? (
            <EmptyState
              icon={<History className="size-6" aria-hidden />}
              title="No entries match"
              description="Try widening the filters."
            />
          ) : (
            <>
              <div className="relative overflow-x-auto">
                <Table>
                  <thead>
                    <Tr>
                      <Th>When</Th>
                      <Th>Action</Th>
                      <Th>Entity</Th>
                      <Th>Actor</Th>
                      <Th>Changes</Th>
                    </Tr>
                  </thead>
                  <tbody>
                    {data.rows.map((entry) => {
                      const actor = actorTone(entry);
                      const isOpen = expanded === entry.id;
                      return (
                        <Tr key={entry.id}>
                          <Td className="whitespace-nowrap">{formatDate(entry.createdAt)}</Td>
                          <Td>
                            <code className="text-xs">{entry.action}</code>
                          </Td>
                          <Td className="text-xs text-muted">
                            {entry.entityType ?? "—"}
                            {entry.entityId && (
                              <span className="block truncate" title={entry.entityId}>
                                {entry.entityId}
                              </span>
                            )}
                          </Td>
                          <Td>
                            <StatusPill tone={actor.tone}>{actor.label}</StatusPill>
                          </Td>
                          <Td>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-expanded={isOpen}
                              onClick={() => setExpanded(isOpen ? null : entry.id)}
                            >
                              {summarizeChanges(entry.changes)}
                            </Button>
                            {isOpen && (
                              <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted/40 p-2 text-xs">
                                {JSON.stringify(entry.changes, null, 2)}
                              </pre>
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
              <div className="mt-4">
                <Pager page={page} pageSize={data.pageSize} total={data.total} noun="entries" onPage={setPage} />
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {retentionOpen && (
        <RetentionDialog
          current={retention?.retentionDays ?? 365}
          onClose={() => setRetentionOpen(false)}
          onSaved={() => {
            setRetentionOpen(false);
            void mutate();
          }}
        />
      )}
      {purgeOpen && (
        <PurgeDialog onClose={() => setPurgeOpen(false)} onDone={() => { setPurgeOpen(false); void mutate(); }} />
      )}
      {stepUp.dialog}
    </div>
  );
}

function RetentionDialog({
  current,
  onClose,
  onSaved,
}: {
  current: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const stepUp = useStepUp();
  const [days, setDays] = useState(current);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await stepUp.run(() =>
        apiFetch("/audit-log/retention", { method: "PATCH", json: { retentionDays: days } }),
      );
      toast.success(`Retention set to ${days} days.`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save retention.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Audit retention"
      description="Entries older than this are eligible for purging (30–3,650 days)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={(e) => void submit(e)}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)}>
        <Field label="Keep entries for (days)" required>
          {(control) => (
            <Input
              {...control}
              type="number"
              min={30}
              max={3650}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function PurgeDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const stepUp = useStepUp();
  const [olderThan, setOlderThan] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!olderThan) return;
    setBusy(true);
    try {
      const result = await stepUp.run(() =>
        apiFetch<{ purged: number }>("/audit-log/purge", {
          method: "POST",
          json: { olderThan },
        }),
      );
      toast.success(`Purged ${result.purged} old entries.`);
      onDone();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not purge entries.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Purge old entries"
      description="Permanently deletes entries older than the given date (and the retention window), keeping the newest 1,000. The purge itself is recorded."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy || !olderThan} onClick={(e) => void submit(e)}>
            Purge
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)}>
        <Field label="Delete entries older than" required>
          {(control) => (
            <Input {...control} type="date" value={olderThan} onChange={(e) => setOlderThan(e.target.value)} />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
