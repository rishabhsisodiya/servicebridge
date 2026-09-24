"use client";

import { FlaskConical } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/features/auth/password-input";
import { ApiError } from "@/lib/api/client";
import {
  type Connection,
  type ConnectionInput,
  erpApi,
  type SavedSecrets,
  type TestResult,
} from "./api";
import { TestResultView } from "./test-result-view";

interface ConnectionDrawerProps {
  open: boolean;
  /** Omit to add a new connection. */
  connection?: Connection;
  onClose: () => void;
  /** Saves; the parent wraps this in the password check. */
  onSave: (input: ConnectionInput, useDb: boolean) => Promise<void>;
  /** Fetches saved secrets for editing; the parent wraps this in the password check. */
  onReveal?: () => Promise<SavedSecrets>;
}

type FieldName =
  | "name"
  | "baseUrl"
  | "apiKey"
  | "apiSecret"
  | "db.host"
  | "db.port"
  | "db.database"
  | "db.user"
  | "db.password"
  | "db.connectionLimit";

export function ConnectionDrawer(props: ConnectionDrawerProps) {
  return (
    <ConnectionForm key={props.open ? (props.connection?.id ?? "new") : "closed"} {...props} />
  );
}

function ConnectionForm({ open, connection, onClose, onSave, onReveal }: ConnectionDrawerProps) {
  const editing = !!connection;
  const [values, setValues] = useState({
    name: connection?.name ?? "",
    baseUrl: connection?.baseUrl ?? "",
    apiKey: "",
    apiSecret: "",
    dbHost: connection?.db?.host ?? "",
    dbPort: String(connection?.db?.port ?? 3306),
    dbName: connection?.db?.database ?? "",
    dbUser: connection?.db?.user ?? "",
    dbPassword: "",
    dbSsl: connection?.db?.ssl ?? true,
    dbLimit: String(connection?.db?.connectionLimit ?? 3),
  });
  const [useDb, setUseDb] = useState(!!connection?.db);
  const [errors, setErrors] = useState<Partial<Record<FieldName | "form", string>>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult>();
  const [revealing, setRevealing] = useState(false);

  const reveal = async () => {
    if (!onReveal) return;
    setRevealing(true);
    try {
      const saved = await onReveal();
      setValues((v) => ({
        ...v,
        apiKey: saved.apiKey,
        apiSecret: saved.apiSecret,
        dbPassword: saved.dbPassword ?? v.dbPassword,
      }));
    } catch (caught) {
      setErrors(apiErrors(caught));
    } finally {
      setRevealing(false);
    }
  };

  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: event.target.value }));

  const input = (): ConnectionInput => ({
    name: values.name.trim(),
    baseUrl: values.baseUrl.trim(),
    apiKey: values.apiKey.trim(),
    apiSecret: values.apiSecret.trim(),
    db: useDb
      ? {
          host: values.dbHost.trim(),
          port: Number(values.dbPort),
          database: values.dbName.trim(),
          user: values.dbUser.trim(),
          password: values.dbPassword || undefined,
          ssl: values.dbSsl,
          connectionLimit: Number(values.dbLimit),
        }
      : undefined,
  });

  /** Checks what the browser can check; the API validates everything again. */
  const localErrors = (forTest: boolean) => {
    const next: typeof errors = {};
    if (!forTest && values.name.trim().length < 3) next.name = "Use at least 3 characters.";
    if (!/^https?:\/\/\S+$/.test(values.baseUrl.trim()))
      next.baseUrl = "Enter the full address, for example https://erp.yourcompany.com";
    // Editing: blank secrets keep (and are tested with) the saved values.
    const needSecrets = !editing;
    if (needSecrets && !values.apiKey.trim()) next.apiKey = "Enter the API key.";
    if (needSecrets && !values.apiSecret.trim()) next.apiSecret = "Enter the API secret.";
    if (useDb) {
      if (!values.dbHost.trim()) next["db.host"] = "Enter the database host.";
      if (!values.dbName.trim()) next["db.database"] = "Enter the database name.";
      if (!values.dbUser.trim()) next["db.user"] = "Enter the database user.";
      const limit = Number(values.dbLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20)
        next["db.connectionLimit"] = "Enter a whole number from 1 to 20.";
      if (!connection?.db?.hasPassword && !values.dbPassword)
        next["db.password"] = "Enter the database password.";
    }
    return next;
  };

  const apiErrors = (caught: unknown): typeof errors => {
    const apiError = caught instanceof ApiError ? caught : undefined;
    if (apiError?.code === "STEP_UP_CANCELLED") return {};
    const mapped: typeof errors = {};
    for (const field of apiError?.fields ?? []) mapped[field.field as FieldName] = field.message;
    if (!Object.keys(mapped).length)
      mapped.form = apiError?.message ?? "Something went wrong. Try again.";
    return mapped;
  };

  const runTest = async () => {
    const next = localErrors(true);
    setErrors(next);
    setResult(undefined);
    if (Object.keys(next).length) return;
    setTesting(true);
    try {
      setResult(await erpApi.testDraft({ ...input(), connectionId: connection?.id }));
    } catch (caught) {
      setErrors(apiErrors(caught));
    } finally {
      setTesting(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = localErrors(false);
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await onSave(input(), useDb);
    } catch (caught) {
      setErrors(apiErrors(caught));
    } finally {
      setSaving(false);
    }
  };

  const secretHelp = (hint?: string) =>
    editing ? `Saved${hint ? ` (ends in ${hint})` : ""}. Leave blank to keep it.` : undefined;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `Edit “${connection.name}”` : "Add an ERP connection"}
      description="ERPNext only. Credentials are stored encrypted and never shown again."
      className="w-[min(520px,100vw)]!"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="erp-form" variant="primary" loading={saving}>
            {editing ? "Save changes" : "Save connection"}
          </Button>
        </>
      }
    >
      <form id="erp-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && (
          <p role="alert" className="rounded-lg bg-bad-bg px-3.5 py-2.5 text-[13px] text-bad">
            {errors.form}
          </p>
        )}
        <Field
          label="Name"
          required
          error={errors.name}
          help="What your team calls it, e.g. “Head office ERPNext”."
        >
          {(p) => <Input {...p} autoComplete="off" value={values.name} onChange={set("name")} />}
        </Field>
        <Field
          label="ERPNext address"
          required
          error={errors.baseUrl}
          help="The address you open ERPNext at, without any path."
        >
          {(p) => (
            <Input
              {...p}
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://erp.yourcompany.com"
              value={values.baseUrl}
              onChange={set("baseUrl")}
            />
          )}
        </Field>
        <p className="rounded-lg bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">
          In ERPNext, open the user ServiceBridge should use, then{" "}
          <span className="font-semibold text-text">Settings → API Access → Generate Keys</span>.
          Give that user only the roles it needs; the test below shows what it can read.
        </p>
        {editing && onReveal && (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => void reveal()} loading={revealing}>
              Show saved values
            </Button>
            <span className="text-xs text-muted">
              Asks for your password. Recorded in the audit log.
            </span>
          </div>
        )}
        <Field
          label="API key"
          required={!editing}
          error={errors.apiKey}
          help={secretHelp(connection?.apiKeyHint)}
        >
          {(p) => (
            <Input
              {...p}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              value={values.apiKey}
              onChange={set("apiKey")}
            />
          )}
        </Field>
        <Field label="API secret" required={!editing} error={errors.apiSecret} help={secretHelp()}>
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              value={values.apiSecret}
              onChange={set("apiSecret")}
            />
          )}
        </Field>

        <fieldset className="flex flex-col gap-4 rounded-xl border border-line p-4">
          <legend className="px-1 text-[13px] font-semibold">Database access (optional)</legend>
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
            <input
              type="checkbox"
              checked={useDb}
              onChange={(e) => setUseDb(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--accent-strong)]"
            />
            <span>
              Also read the ERPNext database directly
              <span className="block text-muted">
                Makes large dashboards faster. Use a database user that can only read. Hosted
                ERPNext sites usually don&apos;t allow this.
              </span>
            </span>
          </label>
          {useDb && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_110px]">
              <Field label="Host" required error={errors["db.host"]}>
                {(p) => (
                  <Input
                    {...p}
                    autoComplete="off"
                    spellCheck={false}
                    value={values.dbHost}
                    onChange={set("dbHost")}
                  />
                )}
              </Field>
              <Field label="Port" required error={errors["db.port"]}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    value={values.dbPort}
                    onChange={set("dbPort")}
                  />
                )}
              </Field>
              <Field label="Database name" required error={errors["db.database"]}>
                {(p) => (
                  <Input
                    {...p}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    value={values.dbName}
                    onChange={set("dbName")}
                  />
                )}
              </Field>
              <Field label="User" required error={errors["db.user"]}>
                {(p) => (
                  <Input
                    {...p}
                    autoComplete="off"
                    spellCheck={false}
                    value={values.dbUser}
                    onChange={set("dbUser")}
                  />
                )}
              </Field>
              <Field
                label="Password"
                required={!connection?.db?.hasPassword}
                error={errors["db.password"]}
                help={connection?.db?.hasPassword ? "Saved. Leave blank to keep it." : undefined}
                className="sm:col-span-2"
              >
                {(p) => (
                  <PasswordInput
                    {...p}
                    autoComplete="off"
                    value={values.dbPassword}
                    onChange={set("dbPassword")}
                  />
                )}
              </Field>
              <Field
                label="Connection limit"
                required
                error={errors["db.connectionLimit"]}
                help="Most queries ServiceBridge runs at once against the ERP database (1–20). Keep it low so dashboards never slow ERPNext down."
                className="sm:col-span-2"
              >
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={20}
                    value={values.dbLimit}
                    onChange={set("dbLimit")}
                    className="sm:max-w-32"
                  />
                )}
              </Field>
              <label className="flex cursor-pointer items-center gap-2.5 text-[13px] sm:col-span-2">
                <input
                  type="checkbox"
                  checked={values.dbSsl}
                  onChange={(e) => setValues((v) => ({ ...v, dbSsl: e.target.checked }))}
                  className="size-4 accent-[var(--accent-strong)]"
                />
                Encrypt the connection (SSL) and check the server&apos;s certificate
              </label>
            </div>
          )}
        </fieldset>

        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={runTest}
              loading={testing}
              icon={<FlaskConical className="size-4" aria-hidden />}
            >
              {testing ? "Testing…" : "Test before saving"}
            </Button>
            <span className="text-xs text-muted">
              {editing
                ? "Needs the API key and secret typed in again."
                : "Checks access. Reads no customer or sales data."}
            </span>
          </div>
          {result && <TestResultView result={result} />}
        </div>
      </form>
    </Drawer>
  );
}
