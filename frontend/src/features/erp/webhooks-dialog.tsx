"use client";

import { Copy, Webhook } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";

interface SetupInfo {
  url: string;
  hasSecret: boolean;
  doctypes: string[];
  events: string[];
  templates: Record<string, string>;
  lastReceivedAt: string | null;
}

interface WebhooksDialogProps {
  connectionId: string | null;
  connectionName: string;
  onClose: () => void;
  /** Wraps calls that need a fresh password check. */
  stepUp: <T>(action: () => Promise<T>) => Promise<T>;
}

function CopyField({
  label,
  value,
  mono = true,
  help,
}: {
  label: string;
  value: string;
  mono?: boolean;
  help?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Field label={label} help={help}>
      {(p) => (
        <div className="flex gap-2">
          <Input
            {...p}
            readOnly
            value={value}
            className={mono ? "font-mono text-xs" : undefined}
            onFocus={(e) => e.target.select()}
          />
          <Button
            icon={<Copy className="size-4" aria-hidden />}
            onClick={() =>
              void navigator.clipboard.writeText(value).then(
                () => setCopied(true),
                () => undefined,
              )
            }
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
    </Field>
  );
}

/** Sets up ERPNext webhooks so changes reach ServiceBridge within seconds. */
export function WebhooksDialog({
  connectionId,
  connectionName,
  onClose,
  stepUp,
}: WebhooksDialogProps) {
  const toast = useToast();
  const { data, mutate } = useSWR<SetupInfo>(
    connectionId ? `/erp/connections/${connectionId}/webhooks` : null,
    (key: string) => apiFetch<SetupInfo>(key),
  );
  const [busy, setBusy] = useState<"create" | "secret" | null>(null);
  const [secret, setSecret] = useState<string>();
  const [manual, setManual] = useState(false);

  const close = () => {
    setSecret(undefined);
    setManual(false);
    onClose();
  };

  const fail = (caught: unknown) => {
    if (caught instanceof ApiError && caught.code === "STEP_UP_CANCELLED") return;
    toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
  };

  const createInErp = async () => {
    setBusy("create");
    try {
      const result = await stepUp(() =>
        apiFetch<{ created: string[]; existing: string[] }>(
          `/erp/connections/${connectionId}/webhooks/create-in-erp`,
          { method: "POST" },
        ),
      );
      toast.success(
        result.created.length
          ? `Created ${result.created.length} webhooks in ERPNext${result.existing.length ? ` (${result.existing.length} were already there)` : ""}.`
          : "All webhooks were already set up in ERPNext.",
      );
      await mutate();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  };

  const newSecret = async () => {
    setBusy("secret");
    try {
      const result = await stepUp(() =>
        apiFetch<{ secret: string }>(`/erp/connections/${connectionId}/webhooks/secret`, {
          method: "POST",
        }),
      );
      setSecret(result.secret);
      await mutate();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={connectionId !== null}
      onClose={close}
      title={`Webhooks for “${connectionName}”`}
      description="ERPNext tells ServiceBridge when a record changes, so changes arrive within seconds instead of at the nightly catch-up."
      className="w-[min(640px,calc(100vw-32px))]!"
      footer={<Button onClick={close}>Done</Button>}
    >
      {data && (
        <div className="flex flex-col gap-4 text-[13px]">
          <CopyField
            label="Address ERPNext will call"
            value={data.url}
            help="ERPNext must be able to reach this address. A cloud ERP can't reach localhost; set PUBLIC_WEBHOOK_BASE_URL to a tunnel address for local testing."
          />
          <p className="text-muted">
            Record types: {data.doctypes.join(", ")}. Stock levels are updated by the nightly
            catch-up only, because they change too often.
          </p>
          <p>
            {data.lastReceivedAt
              ? `Last webhook received ${new Date(data.lastReceivedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`
              : "No webhooks received yet."}{" "}
            Remember to switch on{" "}
            <span className="font-semibold">Apply changes from ERPNext (webhooks)</span> under
            Settings → Automations.
          </p>

          <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
            <p className="font-semibold">Set it up automatically</p>
            <p className="text-muted">
              Creates {data.doctypes.length * data.events.length} Webhook records in ERPNext (one
              per record type for “changed” and “deleted”). Skips any that already exist. Needs an
              API user allowed to create Webhooks.
            </p>
            <div>
              <Button
                variant="strong"
                icon={<Webhook className="size-4" aria-hidden />}
                loading={busy === "create"}
                onClick={() => void createInErp()}
              >
                Create webhooks in ERPNext
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              aria-expanded={manual}
              onClick={() => setManual((v) => !v)}
              className="cursor-pointer self-start font-semibold underline-offset-2 hover:underline"
            >
              {manual ? "Hide manual setup" : "Set it up by hand instead"}
            </button>
            {manual && (
              <div className="flex flex-col gap-3">
                <p className="text-muted">
                  In ERPNext, add a Webhook for each record type above and each event (on_update,
                  on_trash): method POST, request structure JSON, “Enable security” on with the
                  secret below, and this JSON body:
                </p>
                <CopyField
                  label="JSON body (for on_update)"
                  value={data.templates.on_update ?? ""}
                />
                {secret ? (
                  <CopyField
                    label="Webhook secret (shown once)"
                    value={secret}
                    help="Copy it now. Creating a new secret stops the old one working."
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button loading={busy === "secret"} onClick={() => void newSecret()}>
                      {data.hasSecret ? "Create a new secret" : "Create a secret"}
                    </Button>
                    {data.hasSecret && (
                      <span className="text-xs text-muted">
                        A secret exists. A new one replaces it.
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
