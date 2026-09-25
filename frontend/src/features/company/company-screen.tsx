"use client";

import { Copy, FlaskConical, Lock, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useStepUp } from "@/features/auth/use-step-up";
import { apiFetch, ApiError } from "@/lib/api/client";
import { APP_SETTINGS_KEY, type CompanySettings, useAppSettings } from "@/lib/app-settings";
import { useSession } from "@/lib/auth/session";

const CONFIRM = "DELETE DEMO DATA";

interface DemoStatus {
  active: boolean;
  counts: Record<string, number>;
}

interface LoadResult {
  password: string;
  logins: { name: string; email: string; role: string }[];
}

const COUNT_LABELS: Record<string, string> = {
  users: "demo users",
  regions: "regions",
  customers: "customers",
  sites: "sites",
  contacts: "contacts",
  machines: "machines",
  items: "items",
  prices: "prices",
  warehouses: "warehouses",
  stockLevels: "stock levels",
  tickets: "tickets",
};

export function CompanyScreen() {
  const { can, me } = useSession();
  if (me && !can("settings.manage")) {
    return (
      <>
        <PageHeader title="Company & demo data" />
        <Card>
          <EmptyState
            icon={<Lock className="size-6" />}
            title="You don't have access to this"
            description="Only administrators can change company settings."
          />
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Company & demo data"
        description="Your company details, and the fictional demo company used for trying ServiceBridge."
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CompanyCard />
        <DemoCard />
      </div>
    </>
  );
}

function CompanyCard() {
  const { data } = useAppSettings();
  return (
    <Card aria-labelledby="company-title">
      <CardHeader titleId="company-title" title="Company" />
      <CardBody>
        {data ? (
          <CompanyForm key={JSON.stringify(data.company)} company={data.company} />
        ) : (
          <Skeleton className="h-40" />
        )}
      </CardBody>
    </Card>
  );
}

function CompanyForm({ company }: { company: CompanySettings }) {
  const toast = useToast();
  const [values, setValues] = useState({
    ...company,
    gstRatePercent: String(company.gstRatePercent),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await apiFetch("/settings/app/company", {
        method: "PATCH",
        json: {
          ...values,
          gstRatePercent: Number(values.gstRatePercent),
          currency: values.currency.toUpperCase(),
        },
      });
      await globalMutate(APP_SETTINGS_KEY);
      toast.success("Company settings saved.");
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : undefined;
      setErrors(Object.fromEntries((apiError?.fields ?? []).map((f) => [f.field, f.message])));
      if (!apiError?.fields.length) toast.error(apiError?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field
        label="Company name"
        required
        error={errors.name}
        className="sm:col-span-2"
        help="Shown in the menu and on documents."
      >
        {(p) => (
          <Input {...p} value={values.name} onChange={set("name")} autoComplete="organization" />
        )}
      </Field>
      <Field label="Time zone" error={errors.timezone} help="Used for schedules, SLAs and reports.">
        {(p) => (
          <Input
            {...p}
            value={values.timezone}
            onChange={set("timezone")}
            placeholder="Asia/Kolkata"
          />
        )}
      </Field>
      <Field label="Currency" error={errors.currency}>
        {(p) => (
          <Input
            {...p}
            value={values.currency}
            onChange={set("currency")}
            maxLength={3}
            className="uppercase sm:max-w-24"
          />
        )}
      </Field>
      <Field label="GST rate (%)" error={errors.gstRatePercent} help="Default tax on quotations.">
        {(p) => (
          <Input
            {...p}
            inputMode="decimal"
            value={values.gstRatePercent}
            onChange={set("gstRatePercent")}
            className="sm:max-w-24"
          />
        )}
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="strong" loading={saving}>
          Save
        </Button>
      </div>
    </form>
  );
}

function DemoCard() {
  const toast = useToast();
  const stepUp = useStepUp();
  const { data, mutate } = useSWR<DemoStatus>("/demo", (key: string) => apiFetch<DemoStatus>(key));
  const [busy, setBusy] = useState<"load" | "clear" | null>(null);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [clearing, setClearing] = useState(false);
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = () => Promise.all([mutate(), globalMutate(APP_SETTINGS_KEY)]);
  const fail = (caught: unknown) => {
    if (caught instanceof ApiError && caught.code === "STEP_UP_CANCELLED") return;
    toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
  };

  const load = async () => {
    setBusy("load");
    try {
      setResult(await stepUp.run(() => apiFetch<LoadResult>("/demo/load", { method: "POST" })));
      await refresh();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  };

  const clear = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("clear");
    try {
      await stepUp.run(() => apiFetch("/demo/clear", { method: "POST", json: { confirm: typed } }));
      setClearing(false);
      setTyped("");
      toast.success("Demo data cleared. Your ERP data and real users were not touched.");
      await refresh();
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  };

  const counts = Object.entries(data?.counts ?? {}).filter(([, n]) => n > 0);

  return (
    <Card aria-labelledby="demo-title">
      <CardHeader titleId="demo-title" title="Demo data" />
      <CardBody className="flex flex-col gap-4">
        <p className="text-[13px] text-muted">
          A fictional company, Apex Crushing Systems, with demo users for every role, customers,
          machines, spares and stock. Useful for demos and training. Demo records are kept separate:
          clearing them never touches ERP data or real users.
        </p>
        {!data ? (
          <Skeleton className="h-10" />
        ) : data.active ? (
          <p className="text-[13px]">
            <span className="font-semibold">Loaded:</span>{" "}
            {counts.map(([key, n]) => `${n} ${COUNT_LABELS[key] ?? key}`).join(", ")}.
          </p>
        ) : (
          <p className="text-[13px]">No demo data is loaded.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon={<FlaskConical className="size-4" aria-hidden />}
            loading={busy === "load"}
            onClick={() => void load()}
          >
            {data?.active ? "Reset demo data" : "Load demo data"}
          </Button>
          {data?.active && (
            <Button
              variant="danger"
              icon={<Trash2 className="size-4" aria-hidden />}
              onClick={() => setClearing(true)}
            >
              Clear demo data…
            </Button>
          )}
        </div>
        {data?.active && (
          <p className="text-xs text-muted">
            Reset replaces the demo data with a fresh copy and gives demo users a new password.
          </p>
        )}
      </CardBody>

      <Dialog
        open={result !== null}
        onClose={() => setResult(null)}
        title="Demo data loaded"
        description="All demo users share this password. It isn't shown again; reset the demo data to get a new one."
        footer={
          <Button variant="strong" onClick={() => setResult(null)}>
            Done
          </Button>
        }
      >
        {result && (
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5">
              <span className="text-muted">Password:</span>
              <code className="font-mono font-semibold">{result.password}</code>
              <Button
                size="sm"
                className="ml-auto"
                icon={<Copy className="size-3.5" aria-hidden />}
                onClick={() =>
                  void navigator.clipboard.writeText(result.password).then(
                    () => setCopied(true),
                    () => undefined,
                  )
                }
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <ul className="m-0 flex max-h-72 list-none flex-col gap-1 overflow-y-auto p-0">
              {result.logins.map((login) => (
                <li key={login.email} className="flex flex-wrap justify-between gap-x-3">
                  <span className="font-mono text-xs">{login.email}</span>
                  <span className="text-xs text-muted">
                    {login.role.replace("_", " ").toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Dialog>

      <Dialog
        open={clearing}
        onClose={() => {
          setClearing(false);
          setTyped("");
        }}
        title="Clear demo data?"
        description="Removes demo customers, machines, spares, stock, demo users and demo regions. ERP-synced records and real users stay."
        footer={
          <>
            <Button onClick={() => setClearing(false)}>Cancel</Button>
            <Button
              type="submit"
              form="clear-demo-form"
              variant="danger"
              loading={busy === "clear"}
              disabled={typed !== CONFIRM}
            >
              Clear demo data
            </Button>
          </>
        }
      >
        <form id="clear-demo-form" onSubmit={clear} noValidate>
          <Field label={`Type ${CONFIRM} to confirm`}>
            {(p) => (
              <Input
                {...p}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="font-mono"
              />
            )}
          </Field>
        </form>
      </Dialog>
      {stepUp.dialog}
    </Card>
  );
}
