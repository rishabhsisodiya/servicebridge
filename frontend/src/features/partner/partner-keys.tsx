"use client";

import { Copy, KeyRound, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { StatusPill } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession, type Permission } from "@/lib/auth/session";
import { useStepUp } from "@/features/auth/use-step-up";
import { formatDate } from "@/features/catalog/shared";

/* ── Types (mirror the backend partner-keys API) ──────────────────────────── */

export interface PartnerKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdBy: { id: string; name: string } | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedPartnerKey extends PartnerKey {
  /** The raw key — returned exactly once, on create. */
  key: string;
}

/** Scopes a partner key can meaningfully hold (partners see tickets only). */
export const PARTNER_SCOPES = [
  { value: "tickets.create", label: "Log tickets", help: "POST /partner/v1/tickets" },
  { value: "tickets.read", label: "Read own ticket status", help: "GET /partner/v1/tickets/:number" },
] as const;

const PARTNER_READ: Permission = "partner.read";
const PARTNER_EDIT: Permission = "partner.edit";

const api = {
  list: () => apiFetch<PartnerKey[]>("/partner-keys"),
  create: (body: { name: string; scopes: string[]; expiresAt?: string }) =>
    apiFetch<CreatedPartnerKey>("/partner-keys", { method: "POST", json: body }),
  revoke: (id: string) =>
    apiFetch<PartnerKey>(`/partner-keys/${id}/revoke`, {
      method: "POST",
      json: { confirm: "revoke" },
    }),
};

export function keyStatus(key: PartnerKey): { label: string; tone: "ok" | "bad" | "neutral" } {
  if (key.revokedAt) return { label: "Revoked", tone: "bad" };
  if (key.expiresAt && new Date(key.expiresAt) <= new Date()) return { label: "Expired", tone: "neutral" };
  return { label: "Active", tone: "ok" };
}

export function PartnerKeysScreen() {
  const { can } = useSession();
  const toast = useToast();
  const stepUp = useStepUp();
  const canEdit = can(PARTNER_EDIT);
  const { data, error, isLoading, mutate } = useSWR(can(PARTNER_READ) ? "/partner-keys" : null, api.list);

  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedPartnerKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<PartnerKey | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRevoke(key: PartnerKey) {
    setBusy(true);
    try {
      await stepUp.run(() => api.revoke(key.id));
      toast.success(`Key "${key.name}" revoked.`);
      setRevoking(null);
      void mutate();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not revoke the key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Partner API keys"
        description="Keys for partners who log tickets through the partner API. Only the key hash is stored — the key itself is shown once, when created."
        actions={
          canEdit ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> New key
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader title="API keys" />
        <CardBody>
          {isLoading ? (
            <TableSkeleton rows={3} />
          ) : error ? (
            <ErrorState title="Could not load API keys." onRetry={() => void mutate()} />
          ) : !data?.length ? (
            <EmptyState
              icon={<KeyRound className="size-6" aria-hidden />}
              title="No partner keys yet"
              description="Create a key to let a partner log tickets via POST /partner/v1/tickets."
            />
          ) : (
            <Table>
              <thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Key</Th>
                  <Th>Scopes</Th>
                  <Th>Status</Th>
                  <Th>Last used</Th>
                  <Th>Expires</Th>
                  {canEdit && <Th aria-label="Actions" />}
                </Tr>
              </thead>
              <tbody>
                {data.map((key) => {
                  const status = keyStatus(key);
                  return (
                    <Tr key={key.id}>
                      <Td>
                        <div className="font-medium">{key.name}</div>
                        {key.createdBy && (
                          <div className="text-xs text-muted">by {key.createdBy.name}</div>
                        )}
                      </Td>
                      <Td>
                        <code className="text-xs">{key.keyPrefix}…</code>
                      </Td>
                      <Td>
                        <div className="text-xs text-muted">{key.scopes.join(", ")}</div>
                      </Td>
                      <Td>
                        <StatusPill tone={status.tone}>{status.label}</StatusPill>
                      </Td>
                      <Td>{key.lastUsedAt ? formatDate(key.lastUsedAt) : "—"}</Td>
                      <Td>{key.expiresAt ? formatDate(key.expiresAt) : "Never"}</Td>
                      {canEdit && (
                        <Td>
                          {!key.revokedAt && (
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busy}
                              onClick={() => setRevoking(key)}
                            >
                              Revoke
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
        </CardBody>
      </Card>

      {creating && (
        <CreateKeyDialog
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            setCreating(false);
            setCreated(key);
            setCopied(false);
            void mutate();
          }}
        />
      )}

      {created && (
        <ShowOnceDialog
          created={created}
          copied={copied}
          onCopy={async () => {
            await navigator.clipboard.writeText(created.key);
            setCopied(true);
          }}
          onClose={() => setCreated(null)}
        />
      )}

      {revoking && (
        <Dialog
          open
          onClose={() => setRevoking(null)}
          title={`Revoke "${revoking.name}"?`}
          description="The key stops working immediately. The partner will need a new key to keep logging tickets."
          footer={
            <>
              <Button variant="ghost" onClick={() => setRevoking(null)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void handleRevoke(revoking)}>
                Revoke key
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            Prefix <code>{revoking.keyPrefix}…</code> · scopes {revoking.scopes.join(", ")}
          </p>
        </Dialog>
      )}
      {stepUp.dialog}
    </div>
  );
}

function CreateKeyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (key: CreatedPartnerKey) => void;
}) {
  const toast = useToast();
  const stepUp = useStepUp();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["tickets.create", "tickets.read"]);
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);

  function toggleScope(value: string) {
    setScopes((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !scopes.length) return;
    setBusy(true);
    try {
      const created = await stepUp.run(() =>
        api.create({ name: name.trim(), scopes, expiresAt: expiresAt || undefined }),
      );
      onCreated(created);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not create the key.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="New partner API key"
      description="The key is shown once after creation. Grant only the scopes the partner needs."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !name.trim() || !scopes.length} onClick={(e) => void submit(e)}>
            Create key
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Field label="Key name" required>
          {(control) => (
            <Input {...control} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Industries" />
          )}
        </Field>
        <fieldset>
          <legend className="text-sm font-medium">Scopes</legend>
          <div className="mt-2 flex flex-col gap-2">
            {PARTNER_SCOPES.map((scope) => (
              <label key={scope.value} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={scopes.includes(scope.value)}
                  onChange={() => toggleScope(scope.value)}
                />
                <span>
                  <span className="font-medium">{scope.label}</span>
                  <span className="block text-xs text-muted">{scope.help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Expires on" help="Optional. Leave empty for a key that never expires.">
          {(control) => (
            <Input {...control} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function ShowOnceDialog({
  created,
  copied,
  onCopy,
  onClose,
}: {
  created: CreatedPartnerKey;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="Copy the key now"
      description="This is the only time the key is shown. If it is lost, revoke this key and create a new one."
      footer={
        <Button disabled={!copied} onClick={onClose}>
          {copied ? "Done" : "Copy the key first"}
        </Button>
      }
    >
      <div className="flex items-center gap-2 rounded-lg border border-line bg-muted/30 p-3">
        <code className="flex-1 break-all text-sm">{created.key}</code>
        <IconButton label="Copy key" onClick={() => void onCopy()}>
          <Copy className="size-4" aria-hidden />
        </IconButton>
      </div>
      <p className="text-xs text-muted">
        Authenticate with <code>Authorization: Bearer {created.key.slice(0, 12)}…</code>
      </p>
    </Dialog>
  );
}
