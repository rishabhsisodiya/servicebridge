"use client";

import { CheckCircle2, Lock, Send, XCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { StatusPill, Tag, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { PasswordInput } from "@/features/auth/password-input";
import { useStepUp } from "@/features/auth/use-step-up";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";

export type EmailTab = "smtp" | "templates";

const EMAIL_KEY = "/settings/app/email";
const TEMPLATES_KEY = "/settings/app/email/templates";
const LOG_KEY = "/settings/app/email/log";

interface EmailSettings {
  enabled: boolean;
  fromName: string;
  fromAddress: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  hasPassword: boolean;
}

/** The editable SMTP fields, plus a password that is blank until the admin types one. */
interface SmtpForm {
  enabled: boolean;
  fromName: string;
  fromAddress: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

const DEFAULTS: SmtpForm = {
  enabled: false,
  fromName: "",
  fromAddress: "",
  host: "",
  port: 587,
  secure: false,
  username: "",
  password: "",
};

interface EmailTemplate {
  key: string;
  name: string;
  description: string | null;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  enabled: boolean;
  version: number;
}

interface EmailLogRow {
  id: string;
  to: string;
  templateKey: string;
  subject: string;
  status: "PENDING" | "SENT" | "FAILED";
  error: string | null;
  createdAt: string;
}

const TEMPLATE_VARIABLES: Record<string, string[]> = {
  "ticket.assigned": ["companyName", "assigneeName", "ticketNumber", "ticketTitle", "ticketUrl"],
  "sla.breached": ["companyName", "ticketNumber", "ticketTitle", "ticketUrl"],
  "escalation.fired": ["companyName", "ticketNumber", "ticketTitle", "level", "reason", "ticketUrl"],
  "csat.invite": ["companyName", "customerName", "ticketNumber", "feedbackUrl"],
  "auth.invite": ["companyName", "name", "inviteUrl", "expiresIn"],
  "auth.reset": ["companyName", "name", "resetUrl", "expiresIn"],
  "amc.renewal": ["companyName", "contractNumber", "customerName", "endsOn", "daysLeft"],
};

const fail = (caught: unknown, toast: { error: (m: string) => void }) => {
  if (caught instanceof ApiError && caught.code === "STEP_UP_CANCELLED") return;
  toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
};

/** SMTP server, the email template library and recent deliveries. */
export function EmailSettingsScreen({ tab, onTab }: { tab: EmailTab; onTab: (tab: EmailTab) => void }) {
  const { can, me } = useSession();
  const allowed = can("company.read");

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="Email" />
        <Card>
          <EmptyState
            icon={<Lock className="size-6" />}
            title="You don't have access to this"
            description="Only administrators can manage email settings."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Email"
        description="The SMTP server ServiceBridge sends from, and the wording of every automated email."
      />
      <Tabs
        label="Email settings"
        value={tab}
        onChange={onTab}
        items={[
          { key: "smtp", label: "SMTP server" },
          { key: "templates", label: "Templates" },
        ]}
      >
        {tab === "smtp" && <SmtpTab />}
        {tab === "templates" && <TemplatesTab />}
      </Tabs>
    </>
  );
}

function SmtpTab() {
  const toast = useToast();
  const { can } = useSession();
  const stepUp = useStepUp();
  const canEdit = can("company.edit");
  const { data, error, isLoading, mutate } = useSWR<EmailSettings>(EMAIL_KEY, (key: string) =>
    apiFetch<EmailSettings>(key),
  );

  const [form, setForm] = useState<SmtpForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const current: SmtpForm | null = form ?? (data ? { ...data, password: "" } : null);
  const set = <K extends keyof SmtpForm>(key: K, value: SmtpForm[K]) =>
    setForm((f) => ({ ...(f ?? (data ? { ...data, password: "" } : DEFAULTS)), [key]: value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!current) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        enabled: current.enabled,
        host: current.host?.trim(),
        port: Number(current.port),
        secure: current.secure,
        username: current.username?.trim(),
        fromName: current.fromName?.trim(),
        fromAddress: current.fromAddress?.trim(),
      };
      // Blank keeps the stored password; only send it when the admin typed one.
      if (current.password?.trim()) payload.password = current.password;
      await stepUp.run(() =>
        apiFetch(EMAIL_KEY, { method: "PATCH", json: payload }),
      );
      toast.success("Email settings saved.");
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

  const sendTest = async () => {
    if (!testTo.trim()) {
      setTestResult({ ok: false, message: "Enter an address to send the test to." });
      return;
    }
    setTesting(true);
    try {
      await stepUp.run(() =>
        apiFetch(`${EMAIL_KEY}/test`, { method: "POST", json: { to: testTo.trim() } }),
      );
      setTestResult({ ok: true, message: `Test email sent to ${testTo.trim()}.` });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "STEP_UP_CANCELLED") {
        /* user changed their mind */
      } else {
        setTestResult({
          ok: false,
          message: caught instanceof ApiError ? caught.message : "Couldn't send the test email.",
        });
      }
    } finally {
      setTesting(false);
    }
  };

  if (isLoading && !data) {
    return (
      <Card>
        <TableSkeleton rows={6} label="Loading email settings" />
      </Card>
    );
  }
  if (error && !data) {
    return (
      <Card>
        <ErrorState
          title="Couldn't load email settings"
          description={error instanceof ApiError ? error.message : undefined}
          onRetry={() => void mutate()}
        />
      </Card>
    );
  }
  if (!current) return null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="SMTP server" meta="How ServiceBridge sends email" />
        <CardBody>
          <form onSubmit={save} noValidate className="flex max-w-3xl flex-col gap-4">
            <div className="flex items-center gap-3 rounded-lg border border-line px-3.5 py-3">
              <Switch
                label="Email sending"
                checked={current.enabled}
                disabled={!canEdit}
                onChange={(enabled) => set("enabled", enabled)}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">Email sending</span>
                <span className="text-[13px] text-muted">
                  When off, no automated email goes out (invites, feedback requests, alerts).
                </span>
              </div>
            </div>

            <fieldset disabled={!canEdit} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="SMTP host" required={current.enabled} error={errors.host}>
                  {(p) => (
                    <Input
                      {...p}
                      value={current.host ?? ""}
                      placeholder="smtp.example.com"
                      onChange={(e) => set("host", e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Port" required={current.enabled} error={errors.port}>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={1}
                      max={65535}
                      value={current.port ?? 587}
                      onChange={(e) => set("port", Number(e.target.value))}
                    />
                  )}
                </Field>
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  label="Use TLS/SSL"
                  checked={!!current.secure}
                  onChange={(secure) => set("secure", secure)}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[13px] font-semibold">Use TLS/SSL</span>
                  <span className="text-xs text-muted">
                    On for port 465; usually off for 587 (STARTTLS is negotiated).
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Username" help="Usually the same as the sender address.">
                  {(p) => (
                    <Input
                      {...p}
                      autoComplete="username"
                      value={current.username ?? ""}
                      onChange={(e) => set("username", e.target.value)}
                    />
                  )}
                </Field>
                <Field
                  label="Password"
                  error={errors.password}
                  help={
                    data?.hasPassword
                      ? "A password is already saved. Leave blank to keep it."
                      : "Saved encrypted; never shown again."
                  }
                >
                  {(p) => (
                    <PasswordInput
                      {...p}
                      autoComplete="new-password"
                      placeholder={data?.hasPassword ? "••••••••" : ""}
                      value={current.password ?? ""}
                      onChange={(e) => set("password", e.target.value)}
                    />
                  )}
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Sender name">
                  {(p) => (
                    <Input
                      {...p}
                      value={current.fromName ?? ""}
                      onChange={(e) => set("fromName", e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Sender address" required={current.enabled} error={errors.fromAddress}>
                  {(p) => (
                    <Input
                      {...p}
                      type="email"
                      value={current.fromAddress ?? ""}
                      placeholder="service@company.com"
                      onChange={(e) => set("fromAddress", e.target.value)}
                    />
                  )}
                </Field>
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
      </Card>

      {canEdit && (
        <Card>
          <CardHeader title="Test it" meta="Send one email to check the server works" />
          <CardBody className="flex flex-col gap-3">
            <div className="flex max-w-xl flex-wrap items-end gap-2.5">
              <div className="min-w-56 flex-1">
                <Field label="Send to">
                  {(p) => (
                    <Input
                      {...p}
                      type="email"
                      placeholder="you@company.com"
                      value={testTo}
                      onChange={(e) => setTestTo(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Button
                icon={<Send className="size-4" aria-hidden />}
                loading={testing}
                onClick={() => void sendTest()}
              >
                Send test email
              </Button>
            </div>
            {testResult && (
              <p
                role="status"
                className={`flex items-center gap-1.5 text-[13px] font-semibold ${testResult.ok ? "text-ok" : "text-bad"}`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="size-4" aria-hidden />
                ) : (
                  <XCircle className="size-4" aria-hidden />
                )}
                {testResult.message}
              </p>
            )}
          </CardBody>
        </Card>
      )}

      <DeliveryLog />
      {stepUp.dialog}
    </div>
  );
}

const LOG_STATUS: Record<EmailLogRow["status"], { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "prog" },
  SENT: { label: "Sent", tone: "ok" },
  FAILED: { label: "Failed", tone: "bad" },
};

function DeliveryLog() {
  const { data, isLoading } = useSWR<EmailLogRow[]>(LOG_KEY, (key: string) =>
    apiFetch<EmailLogRow[]>(key),
  );

  return (
    <Card>
      <CardHeader title="Recent deliveries" meta="The last 50 emails, newest first" />
      {isLoading && <TableSkeleton rows={4} label="Loading delivery log" />}
      {!isLoading && (!data || data.length === 0) && (
        <p className="px-4 py-6 text-[13px] text-muted">No email has been sent yet.</p>
      )}
      {data && data.length > 0 && (
        <Table caption="Recent email deliveries">
          <thead>
            <tr>
              <Th>To</Th>
              <Th>Subject</Th>
              <Th>Status</Th>
              <Th>Sent</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <Tr key={row.id}>
                <Td className="font-mono text-xs">{row.to}</Td>
                <Td>
                  <span className="block font-semibold">{row.subject}</span>
                  <span className="text-xs text-muted">{row.templateKey}</span>
                  {row.error && (
                    <span className="block text-xs text-bad">{row.error}</span>
                  )}
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

function TemplatesTab() {
  const toast = useToast();
  const { can } = useSession();
  const canEdit = can("company.edit");
  const { data, error, isLoading, mutate } = useSWR<EmailTemplate[]>(TEMPLATES_KEY, (key: string) =>
    apiFetch<EmailTemplate[]>(key),
  );
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (template: EmailTemplate, enabled: boolean) => {
    setBusy(template.key);
    try {
      await apiFetch(`${TEMPLATES_KEY}/${template.key}`, {
        method: "PATCH",
        json: { version: template.version, enabled },
      });
      toast.success(`“${template.name}” is ${enabled ? "on" : "off"}.`);
      await mutate();
    } catch (caught) {
      fail(caught, toast);
    } finally {
      setBusy(null);
    }
  };

  if (isLoading && !data) {
    return (
      <Card>
        <TableSkeleton rows={6} label="Loading email templates" />
      </Card>
    );
  }
  if (error && !data) {
    return (
      <Card>
        <ErrorState
          title="Couldn't load email templates"
          description={error instanceof ApiError ? error.message : undefined}
          onRetry={() => void mutate()}
        />
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Templates"
          meta="The wording of every automated email. Placeholders like {{ticketNumber}} are filled when the email goes out."
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
                {template.description && (
                  <p className="text-[13px] text-muted">{template.description}</p>
                )}
                <p className="truncate font-mono text-xs text-muted">{template.subject}</p>
              </div>
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(template)}>
                  Edit wording
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <TemplateDialog
        template={editing}
        onClose={() => setEditing(null)}
        onSaved={() => void mutate()}
      />
    </>
  );
}

function TemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  template: EmailTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return template ? (
    <TemplateForm
      key={`${template.key}:${template.version}`}
      template={template}
      onClose={onClose}
      onSaved={onSaved}
    />
  ) : null;
}

function TemplateForm({
  template,
  onClose,
  onSaved,
}: {
  template: EmailTemplate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [subject, setSubject] = useState(template.subject);
  const [bodyHtml, setBodyHtml] = useState(template.bodyHtml);
  const [bodyText, setBodyText] = useState(template.bodyText);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const variables = TEMPLATE_VARIABLES[template.key] ?? ["companyName"];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiFetch(`${TEMPLATES_KEY}/${template.key}`, {
        method: "PATCH",
        json: { version: template.version, subject, bodyHtml, bodyText },
      });
      toast.success(`“${template.name}” updated.`);
      onSaved();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "VERSION_CONFLICT") {
        setError("Someone else changed this template. It's reloaded — check and try again.");
        onSaved();
      } else {
        setError(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`“${template.name}” template`}
      description={template.description ?? undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="template-form" variant="strong" loading={saving}>
            Save template
          </Button>
        </>
      }
    >
      <form id="template-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="rounded-lg bg-surface-2 px-3.5 py-2.5 text-[13px]">
          <p className="font-semibold">Available placeholders</p>
          <p className="mt-1 flex flex-wrap gap-1.5">
            {variables.map((name) => (
              <code key={name} className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">
                {`{{${name}}}`}
              </code>
            ))}
          </p>
        </div>
        {error && (
          <p role="alert" className="text-xs font-semibold text-bad">
            {error}
          </p>
        )}
        <Field label="Subject">
          {(p) => <Input {...p} value={subject} onChange={(e) => setSubject(e.target.value)} />}
        </Field>
        <Field label="Body (HTML)" help="Shown in email apps that render HTML.">
          {(p) => (
            <Textarea
              {...p}
              rows={8}
              spellCheck={false}
              className="font-mono text-xs"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
            />
          )}
        </Field>
        <Field label="Body (plain text)" help="Fallback for plain-text email apps.">
          {(p) => (
            <Textarea
              {...p}
              rows={8}
              spellCheck={false}
              className="font-mono text-xs"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
