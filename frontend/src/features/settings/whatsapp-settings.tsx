"use client";

import { CheckCircle2, Lock, Send, XCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { StatusPill, Tag, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { PasswordInput } from "@/features/auth/password-input";
import { useStepUp } from "@/features/auth/use-step-up";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";

const WHATSAPP_KEY = "/settings/whatsapp";
const TEMPLATES_KEY = "/settings/whatsapp/templates";
const CHANNELS_KEY = "/settings/whatsapp/channels";
const LOG_KEY = "/settings/whatsapp/log";

interface WhatsAppSettings {
  enabled: boolean;
  provider: "meta";
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string;
  verifyToken: string;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  webhookUrl: string;
}

/** The provider fields, plus secrets that stay blank until the admin types one. */
interface ProviderForm {
  enabled: boolean;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string;
  verifyToken: string;
  accessToken: string;
  appSecret: string;
}

const DEFAULTS: ProviderForm = {
  enabled: false,
  phoneNumberId: "",
  businessAccountId: "",
  displayPhoneNumber: "",
  verifyToken: "",
  accessToken: "",
  appSecret: "",
};

interface WhatsAppTemplate {
  key: string;
  name: string;
  providerTemplateName: string;
  languageCode: string;
  bodyText: string;
  enabled: boolean;
  version: number;
}

interface ChannelToggle {
  email: boolean;
  whatsapp: boolean;
}

interface WhatsAppLogRow {
  id: string;
  to: string;
  templateKey: string;
  status: "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  error: string | null;
  createdAt: string;
}

const fail = (caught: unknown, toast: { error: (m: string) => void }) => {
  if (caught instanceof ApiError && caught.code === "STEP_UP_CANCELLED") return;
  toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
};

/** Meta WhatsApp Business connection, per-template channel toggles and deliveries. */
export function WhatsAppSettingsScreen() {
  const { can, me } = useSession();
  const allowed = can("company.read");

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="WhatsApp" />
        <Card>
          <EmptyState
            icon={<Lock className="size-6" />}
            title="You don't have access to this"
            description="Only administrators can manage WhatsApp settings."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="The Meta WhatsApp Business connection, which notifications go out over WhatsApp, and the delivery log."
      />
      <div className="flex flex-col gap-4">
        <ProviderCard />
        <ChannelsCard />
        <TemplatesCard />
        <TestCard />
        <DeliveryLog />
      </div>
    </>
  );
}

function ProviderCard() {
  const toast = useToast();
  const { can } = useSession();
  const stepUp = useStepUp();
  const canEdit = can("company.edit");
  const { data, error, isLoading, mutate } = useSWR<WhatsAppSettings>(WHATSAPP_KEY, (key: string) =>
    apiFetch<WhatsAppSettings>(key),
  );

  const [form, setForm] = useState<ProviderForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const current: ProviderForm | null = form ?? (data ? { ...data, accessToken: "", appSecret: "" } : null);
  const set = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) =>
    setForm((f) => ({ ...(f ?? (data ? { ...data, accessToken: "", appSecret: "" } : DEFAULTS)), [key]: value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!current) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        enabled: current.enabled,
        phoneNumberId: current.phoneNumberId?.trim(),
        businessAccountId: current.businessAccountId?.trim(),
        displayPhoneNumber: current.displayPhoneNumber?.trim(),
        verifyToken: current.verifyToken?.trim(),
      };
      // Blank keeps the stored secret; only send it when the admin typed one.
      if (current.accessToken?.trim()) payload.accessToken = current.accessToken;
      if (current.appSecret?.trim()) payload.appSecret = current.appSecret;
      await stepUp.run(() => apiFetch(WHATSAPP_KEY, { method: "PATCH", json: payload }));
      toast.success("WhatsApp settings saved.");
      setErrors({});
      await mutate();
      setForm(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.fields.length) {
        const fieldErrors: Record<string, string> = {};
        for (const f of caught.fields) fieldErrors[f.field] = f.message;
        setErrors(fieldErrors);
      } else {
        fail(caught, toast);
      }
    } finally {
      setSaving(false);
    }
  };

  if (isLoading && !data) {
    return (
      <Card>
        <TableSkeleton rows={6} label="Loading WhatsApp settings" />
      </Card>
    );
  }
  if (error && !data) {
    return (
      <Card>
        <ErrorState
          title="Couldn't load WhatsApp settings"
          description={error instanceof ApiError ? error.message : undefined}
          onRetry={() => void mutate()}
        />
      </Card>
    );
  }
  if (!current) return null;

  return (
    <Card>
      <CardHeader title="WhatsApp Business" meta="Meta Cloud API connection" />
      <CardBody>
        <form onSubmit={save} noValidate className="flex max-w-3xl flex-col gap-4">
          <div className="flex items-center gap-3 rounded-lg border border-line px-3.5 py-3">
            <Switch
              label="WhatsApp sending"
              checked={current.enabled}
              disabled={!canEdit}
              onChange={(enabled) => set("enabled", enabled)}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">WhatsApp sending</span>
              <span className="text-[13px] text-muted">
                When off, no WhatsApp message goes out — even for templates switched on below.
              </span>
            </div>
          </div>

          <fieldset disabled={!canEdit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Phone number ID"
                required={current.enabled}
                error={errors.phoneNumberId}
                help="From the Meta app dashboard (WhatsApp → API setup)."
              >
                {(p) => (
                  <Input
                    {...p}
                    value={current.phoneNumberId ?? ""}
                    placeholder="123456789012345"
                    onChange={(e) => set("phoneNumberId", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Business account ID" help="The WhatsApp Business account ID.">
                {(p) => (
                  <Input
                    {...p}
                    value={current.businessAccountId ?? ""}
                    onChange={(e) => set("businessAccountId", e.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Display phone number"
                error={errors.displayPhoneNumber}
                help="The number customers see, e.g. +919876543210."
              >
                {(p) => (
                  <Input
                    {...p}
                    value={current.displayPhoneNumber ?? ""}
                    placeholder="+91…"
                    onChange={(e) => set("displayPhoneNumber", e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Access token"
                error={errors.accessToken}
                help={
                  data?.hasAccessToken
                    ? "A token is already saved. Leave blank to keep it."
                    : "A permanent token from the Meta app dashboard. Saved encrypted; never shown again."
                }
              >
                {(p) => (
                  <PasswordInput
                    {...p}
                    autoComplete="new-password"
                    placeholder={data?.hasAccessToken ? "••••••••" : ""}
                    value={current.accessToken ?? ""}
                    onChange={(e) => set("accessToken", e.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Verify token"
                help="Paste this into the Meta app dashboard when you register the webhook below."
              >
                {(p) => (
                  <Input
                    {...p}
                    value={current.verifyToken ?? ""}
                    placeholder="Generated when you switch WhatsApp on"
                    onChange={(e) => set("verifyToken", e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="App secret"
                error={errors.appSecret}
                help={
                  data?.hasAppSecret
                    ? "A secret is already saved. Leave blank to keep it."
                    : "From the Meta app dashboard (App settings → Basic). Verifies delivery receipts."
                }
              >
                {(p) => (
                  <PasswordInput
                    {...p}
                    autoComplete="new-password"
                    placeholder={data?.hasAppSecret ? "••••••••" : ""}
                    value={current.appSecret ?? ""}
                    onChange={(e) => set("appSecret", e.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className="rounded-lg bg-surface-2 px-3.5 py-2.5 text-[13px]">
              <p className="font-semibold">Webhook URL</p>
              <p className="mt-1 break-all font-mono text-xs text-muted">{data?.webhookUrl}</p>
              <p className="mt-1 text-muted">
                Register this in the Meta app dashboard (WhatsApp → Configuration) to receive
                delivery receipts.
              </p>
            </div>
          </fieldset>

          {canEdit && (
            <div>
              <Button type="submit" variant="primary" loading={saving}>
                Save settings
              </Button>
            </div>
          )}
        </form>
      </CardBody>
      {stepUp.dialog}
    </Card>
  );
}

function ChannelsCard() {
  const toast = useToast();
  const { can } = useSession();
  const canEdit = can("company.edit");
  const { data: templates } = useSWR<WhatsAppTemplate[]>(TEMPLATES_KEY, (key: string) =>
    apiFetch<WhatsAppTemplate[]>(key),
  );
  const { data: settings } = useSWR<WhatsAppSettings>(WHATSAPP_KEY, (key: string) =>
    apiFetch<WhatsAppSettings>(key),
  );
  const {
    data: channels,
    error,
    isLoading,
    mutate,
  } = useSWR<Record<string, ChannelToggle>>(CHANNELS_KEY, (key: string) =>
    apiFetch<Record<string, ChannelToggle>>(key),
  );
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (key: string, channel: "email" | "whatsapp", value: boolean) => {
    setBusy(`${key}:${channel}`);
    try {
      await apiFetch(CHANNELS_KEY, {
        method: "PATCH",
        json: { channels: { [key]: { [channel]: value } } },
      });
      await mutate();
    } catch (caught) {
      fail(caught, toast);
    } finally {
      setBusy(null);
    }
  };

  if (isLoading && !channels) {
    return (
      <Card>
        <TableSkeleton rows={4} label="Loading channel toggles" />
      </Card>
    );
  }
  if (error && !channels) {
    return (
      <Card>
        <ErrorState
          title="Couldn't load channel toggles"
          description={error instanceof ApiError ? error.message : undefined}
          onRetry={() => void mutate()}
        />
      </Card>
    );
  }

  const masterOn = !!settings?.enabled;

  return (
    <Card>
      <CardHeader
        title="Channels"
        meta="Which template goes out over email, WhatsApp, both or neither"
      />
      {!masterOn && (
        <p className="border-b border-line px-4 py-3 text-[13px] text-muted">
          WhatsApp sending is off, so the WhatsApp column is disabled. Switch it on above to
          enable WhatsApp for a template.
        </p>
      )}
      <Table caption="Per-template channel toggles">
        <thead>
          <tr>
            <Th>Notification</Th>
            <Th>Email</Th>
            <Th>WhatsApp</Th>
          </tr>
        </thead>
        <tbody>
          {(templates ?? []).map((template) => {
            const toggleState = channels?.[template.key];
            const emailOn = toggleState?.email ?? true;
            const whatsappOn = toggleState?.whatsapp ?? false;
            return (
              <Tr key={template.key}>
                <Td>
                  <span className="block font-semibold">{template.name}</span>
                  <span className="font-mono text-xs text-muted">{template.key}</span>
                </Td>
                <Td>
                  <Switch
                    label={`${template.name} over email`}
                    checked={emailOn}
                    disabled={!canEdit}
                    busy={busy === `${template.key}:email`}
                    onChange={(checked) => void toggle(template.key, "email", checked)}
                  />
                </Td>
                <Td>
                  <Switch
                    label={`${template.name} over WhatsApp`}
                    checked={whatsappOn}
                    disabled={!canEdit || !masterOn || !template.enabled}
                    busy={busy === `${template.key}:whatsapp`}
                    onChange={(checked) => void toggle(template.key, "whatsapp", checked)}
                  />
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      {!masterOn || (templates ?? []).some((t) => !t.enabled) ? (
        <p className="border-t border-line px-4 py-3 text-[13px] text-muted">
          A WhatsApp toggle also needs its template switched on in the template list below.
        </p>
      ) : null}
    </Card>
  );
}

function TemplatesCard() {
  const toast = useToast();
  const { can } = useSession();
  const canEdit = can("company.edit");
  const { data, error, isLoading, mutate } = useSWR<WhatsAppTemplate[]>(TEMPLATES_KEY, (key: string) =>
    apiFetch<WhatsAppTemplate[]>(key),
  );
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (template: WhatsAppTemplate, enabled: boolean) => {
    setBusy(template.key);
    try {
      await apiFetch(`${TEMPLATES_KEY}/${template.key}`, {
        method: "PATCH",
        json: { version: template.version, enabled },
      });
      toast.success(`“${template.name}” is ${enabled ? "on" : "off"}.`);
      await mutate();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "VERSION_CONFLICT") {
        toast.error("Someone else changed this template. It's reloaded — try again.");
        await mutate();
      } else {
        fail(caught, toast);
      }
    } finally {
      setBusy(null);
    }
  };

  if (isLoading && !data) {
    return (
      <Card>
        <TableSkeleton rows={4} label="Loading WhatsApp templates" />
      </Card>
    );
  }
  if (error && !data) {
    return (
      <Card>
        <ErrorState
          title="Couldn't load WhatsApp templates"
          description={error instanceof ApiError ? error.message : undefined}
          onRetry={() => void mutate()}
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Templates"
        meta="Meta-approved templates. The wording can't be edited here — it must match the template approved in the Meta dashboard; {{name}} placeholders fill in order when the message goes out."
      />
      <ul className="m-0 list-none p-0">
        {(data ?? []).map((template) => (
          <li
            key={template.key}
            className="flex flex-wrap items-start gap-4 border-b border-line px-4 py-4 last:border-b-0"
          >
            <Switch
              label={template.name}
              checked={template.enabled}
              disabled={!canEdit}
              busy={busy === template.key}
              onChange={(enabled) => void toggle(template, enabled)}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {template.name}
                {!template.enabled && <Tag>Off</Tag>}
              </p>
              <p className="font-mono text-xs text-muted">
                {template.providerTemplateName} · {template.languageCode}
              </p>
              <p className="rounded bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-muted">
                {template.bodyText}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TestCard() {
  const toast = useToast();
  const { can } = useSession();
  const stepUp = useStepUp();
  const canEdit = can("company.edit");
  const { data: templates } = useSWR<WhatsAppTemplate[]>(TEMPLATES_KEY, (key: string) =>
    apiFetch<WhatsAppTemplate[]>(key),
  );
  const [to, setTo] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  if (!canEdit) return null;

  const enabledTemplates = (templates ?? []).filter((t) => t.enabled);
  const chosen = templateKey || enabledTemplates[0]?.key || "";

  const sendTest = async () => {
    if (!to.trim()) {
      setResult({ ok: false, message: "Enter a phone number to send the test to." });
      return;
    }
    if (!chosen) {
      setResult({ ok: false, message: "Switch on a template first." });
      return;
    }
    setTesting(true);
    try {
      await stepUp.run(() =>
        apiFetch(`${WHATSAPP_KEY}/test`, { method: "POST", json: { to: to.trim(), templateKey: chosen } }),
      );
      setResult({ ok: true, message: `Test message sent to ${to.trim()}.` });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "STEP_UP_CANCELLED") {
        /* user changed their mind */
      } else {
        setResult({
          ok: false,
          message: caught instanceof ApiError ? caught.message : "Couldn't send the test message.",
        });
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Test it" meta="Send one template message to check the connection works" />
      <CardBody className="flex flex-col gap-3">
        <div className="flex max-w-xl flex-wrap items-end gap-2.5">
          <div className="min-w-44 flex-1">
            <Field label="Send to">
              {(p) => (
                <Input
                  {...p}
                  placeholder="+919876543210"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="min-w-44 flex-1">
            <Field label="Template">
              {(p) => (
                <Select
                  {...p}
                  value={chosen}
                  onChange={(e) => setTemplateKey(e.target.value)}
                >
                  {enabledTemplates.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Button
            icon={<Send className="size-4" aria-hidden />}
            loading={testing}
            onClick={() => void sendTest()}
          >
            Send test message
          </Button>
        </div>
        {result && (
          <p
            role="status"
            className={`flex items-center gap-1.5 text-[13px] font-semibold ${result.ok ? "text-ok" : "text-bad"}`}
          >
            {result.ok ? (
              <CheckCircle2 className="size-4" aria-hidden />
            ) : (
              <XCircle className="size-4" aria-hidden />
            )}
            {result.message}
          </p>
        )}
      </CardBody>
      {stepUp.dialog}
    </Card>
  );
}

const LOG_STATUS: Record<WhatsAppLogRow["status"], { label: string; tone: Tone }> = {
  QUEUED: { label: "Queued", tone: "prog" },
  SENT: { label: "Sent", tone: "ok" },
  DELIVERED: { label: "Delivered", tone: "ok" },
  READ: { label: "Read", tone: "ok" },
  FAILED: { label: "Failed", tone: "bad" },
};

function DeliveryLog() {
  const { data, isLoading } = useSWR<WhatsAppLogRow[]>(LOG_KEY, (key: string) =>
    apiFetch<WhatsAppLogRow[]>(key),
  );

  return (
    <Card>
      <CardHeader title="Recent deliveries" meta="The last 50 messages, newest first" />
      {isLoading && <TableSkeleton rows={4} label="Loading delivery log" />}
      {!isLoading && (!data || data.length === 0) && (
        <p className="px-4 py-6 text-[13px] text-muted">No WhatsApp message has been sent yet.</p>
      )}
      {data && data.length > 0 && (
        <Table caption="Recent WhatsApp deliveries">
          <thead>
            <tr>
              <Th>To</Th>
              <Th>Template</Th>
              <Th>Status</Th>
              <Th>Sent</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <Tr key={row.id}>
                <Td className="font-mono text-xs">{row.to}</Td>
                <Td>
                  <span className="block font-semibold">{row.templateKey}</span>
                  {row.error && <span className="block text-xs text-bad">{row.error}</span>}
                </Td>
                <Td>
                  <StatusPill tone={LOG_STATUS[row.status].tone}>
                    {LOG_STATUS[row.status].label}
                  </StatusPill>
                </Td>
                <Td className="whitespace-nowrap text-muted">
                  {new Date(row.createdAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
