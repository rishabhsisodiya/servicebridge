"use client";

import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Drawer } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorState, TableSkeleton } from "@/components/ui/states";
import { Sub, Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/auth/session";
import { apiFetch } from "@/lib/api/client";
import { useAppSettings } from "@/lib/app-settings";
import { money } from "@/features/catalog/shared";
import type { BillingData, BillingRateRow, BillingUnit } from "./api";
import { errorsFrom, FormAlert, type FormErrors } from "./shared";

const UNIT_LABEL: Record<BillingUnit, string> = {
  PER_VISIT: "per visit",
  PER_HOUR: "per hour",
  PER_KM: "per km",
  FIXED: "fixed",
};

const KEY = "/service-rules/billing";

export function BillingTab() {
  const canEdit = useSession().can("rules.edit");
  const billing = useSWR<BillingData>(KEY, (k: string) => apiFetch<BillingData>(k));
  const currency = useAppSettings().data?.company.currency ?? "INR";
  const toast = useToast();
  const [editing, setEditing] = useState<BillingRateRow | "new" | null>(null);

  if (billing.error)
    return <ErrorState title="Couldn't load billing" onRetry={() => void billing.mutate()} />;
  if (!billing.data) return <TableSkeleton label="Loading billing" />;

  return (
    <div className="flex flex-col gap-4">
      <PriceListsCard
        readOnly={!canEdit}
        key={`${billing.data.sparesPriceList}|${billing.data.amcPriceList}`}
        data={billing.data}
        onSaved={async () => {
          toast.success("Price lists saved.");
          await billing.mutate();
        }}
      />
      <Card>
        <CardHeader
          title="Service charges"
          meta="Added to chargeable tickets. Taxed at the company GST rate."
          actions={
            canEdit && (
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="size-4" aria-hidden />}
                onClick={() => setEditing("new")}
              >
                Add charge
              </Button>
            )
          }
        />
        <Table caption="Service charges">
          <thead>
            <tr>
              <Th>Charge</Th>
              <Th align="right">Rate</Th>
              <Th>ERP item</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {billing.data.rates.map((r) => (
              <Tr key={r.id}>
                <Td className="min-w-48">
                  <button
                    type="button"
                    onClick={() => setEditing(r)}
                    className="cursor-pointer font-semibold text-text underline-offset-2 hover:underline"
                  >
                    {r.name}
                  </button>
                  <Sub>
                    <span className="font-mono">{r.code}</span>
                  </Sub>
                </Td>
                <Td align="right" className="whitespace-nowrap">
                  {money(r.amount, currency)}{" "}
                  <span className="text-muted">{UNIT_LABEL[r.unit]}</span>
                </Td>
                <Td className="font-mono text-xs">
                  {r.erpItemCode ?? <span className="font-sans text-muted">Not set</span>}
                </Td>
                <Td>
                  {r.active ? (
                    <StatusPill tone="ok">In use</StatusPill>
                  ) : (
                    <StatusPill tone="done">Off</StatusPill>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <RateDrawer
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        rate={editing}
        currency={currency}
        readOnly={!canEdit}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          toast.success(message);
          setEditing(null);
          await billing.mutate();
        }}
      />
    </div>
  );
}

function PriceListsCard({
  data,
  onSaved,
  readOnly,
}: {
  data: BillingData;
  onSaved: () => Promise<void>;
  readOnly: boolean;
}) {
  const [spares, setSpares] = useState(data.sparesPriceList ?? "");
  const [amc, setAmc] = useState(data.amcPriceList ?? "");
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const changed = spares !== (data.sparesPriceList ?? "") || amc !== (data.amcPriceList ?? "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await apiFetch(`${KEY}/price-lists`, {
        method: "PUT",
        json: { sparesPriceList: spares || null, amcPriceList: amc || null },
      });
      await onSaved();
    } catch (caught) {
      setErrors(errorsFrom(caught, ["sparesPriceList", "amcPriceList"]));
    } finally {
      setSaving(false);
    }
  };

  const options = (
    <>
      <option value="">Not set</option>
      {data.priceLists.map((l) => (
        <option key={l.name} value={l.name}>
          {l.name} ({l.itemCount} items)
        </option>
      ))}
    </>
  );

  return (
    <Card>
      <CardHeader title="Spares price lists" meta="Prices come from your ERP (or the demo data)." />
      <CardBody>
        {data.priceLists.length === 0 ? (
          <p className="text-[13px] text-muted">
            No selling prices yet. They arrive with the ERP sync or the demo data.
          </p>
        ) : (
          <form onSubmit={submit} noValidate>
            <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-4">
              <FormAlert message={errors.form} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field
                  label="Chargeable work"
                  error={errors.sparesPriceList}
                  help="Used to quote spares on chargeable tickets."
                >
                  {(p) => (
                    <Select {...p} value={spares} onChange={(e) => setSpares(e.target.value)}>
                      {options}
                    </Select>
                  )}
                </Field>
                <Field
                  label="Machines under AMC"
                  error={errors.amcPriceList}
                  help="Usually a discounted list. Falls back to the one above."
                >
                  {(p) => (
                    <Select {...p} value={amc} onChange={(e) => setAmc(e.target.value)}>
                      {options}
                    </Select>
                  )}
                </Field>
              </div>
              {!readOnly && (
                <div>
                  <Button type="submit" variant="primary" loading={saving} disabled={!changed}>
                    Save price lists
                  </Button>
                </div>
              )}
            </fieldset>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function RateDrawer({
  rate,
  currency,
  onClose,
  onSaved,
  readOnly = false,
}: {
  rate: BillingRateRow | "new" | null;
  currency: string;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  readOnly?: boolean;
}) {
  const existing = rate && rate !== "new" ? rate : null;
  const [values, setValues] = useState({
    code: existing?.code ?? "",
    name: existing?.name ?? "",
    unit: existing?.unit ?? ("PER_VISIT" as BillingUnit),
    amount: existing ? String(existing.amount) : "",
    erpItemCode: existing?.erpItemCode ?? "",
    active: existing?.active ?? true,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const initialValues = {
    code: existing?.code ?? "",
    name: existing?.name ?? "",
    unit: existing?.unit ?? ("PER_VISIT" as BillingUnit),
    amount: existing ? String(existing.amount) : "",
    erpItemCode: existing?.erpItemCode ?? "",
    active: existing?.active ?? true,
  };
  const dirty = (Object.keys(initialValues) as (keyof typeof initialValues)[]).some(
    (k) => values[k] !== initialValues[k],
  );
  const set = (field: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(values.amount);
    const next: FormErrors = {};
    if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(values.code))
      next.code = "Use capital letters, digits and _ (e.g. VISIT).";
    if (values.name.trim().length < 2) next.name = "Enter a name.";
    if (values.amount === "" || !(amount >= 0)) next.amount = "Enter an amount.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    const json = {
      code: values.code,
      name: values.name,
      unit: values.unit,
      amount,
      erpItemCode: values.erpItemCode.trim() || null,
    };
    try {
      if (existing) {
        await apiFetch(`${KEY}/rates/${existing.id}`, {
          method: "PATCH",
          json: { ...json, active: values.active, version: existing.version },
        });
      } else {
        await apiFetch(`${KEY}/rates`, { method: "POST", json });
      }
      await onSaved(existing ? `${values.name.trim()} saved.` : `${values.name.trim()} added.`);
    } catch (caught) {
      setErrors(errorsFrom(caught, ["code", "name", "unit", "amount", "erpItemCode"]));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={!!rate}
      onClose={onClose}
      dirty={dirty && !readOnly}
      title={existing ? `Edit ${existing.name}` : "Add a service charge"}
      description="New rates apply to quotations and invoices made after you save."
      footer={
        <>
          <Button onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
          {!readOnly && (
            <Button type="submit" form="rate-form" variant="primary" loading={saving}>
              {existing ? "Save" : "Add charge"}
            </Button>
          )}
        </>
      }
    >
      <form id="rate-form" onSubmit={submit} noValidate>
        <fieldset disabled={readOnly} className="min-w-0 flex flex-col gap-4">
          <FormAlert message={errors.form} />
          <Field label="Name" required error={errors.name}>
            {(p) => <Input {...p} maxLength={60} value={values.name} onChange={set("name")} />}
          </Field>
          <Field
            label="Code"
            required
            error={errors.code}
            help="A short fixed code used in reports, e.g. VISIT."
          >
            {(p) => (
              <Input
                {...p}
                maxLength={30}
                className="font-mono uppercase"
                value={values.code}
                onChange={(e) => setValues((v) => ({ ...v, code: e.target.value.toUpperCase() }))}
              />
            )}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={`Amount (${currency})`} required error={errors.amount} help="Before GST.">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={values.amount}
                  onChange={set("amount")}
                />
              )}
            </Field>
            <Field label="Charged" error={errors.unit}>
              {(p) => (
                <Select {...p} value={values.unit} onChange={set("unit")}>
                  {(Object.keys(UNIT_LABEL) as BillingUnit[]).map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABEL[u]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field
            label="ERP item code"
            error={errors.erpItemCode}
            help="The service item billed for this charge on the draft invoice in ERPNext."
          >
            {(p) => (
              <Input
                {...p}
                maxLength={140}
                className="font-mono"
                value={values.erpItemCode}
                onChange={set("erpItemCode")}
              />
            )}
          </Field>
          {existing && (
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--accent-strong)]"
                checked={values.active}
                onChange={(e) => setValues((v) => ({ ...v, active: e.target.checked }))}
              />
              <span>
                <span className="block font-semibold">In use</span>
                <span className="text-muted">
                  Turn off to stop offering this charge on new quotations.
                </span>
              </span>
            </label>
          )}
        </fieldset>
      </form>
    </Drawer>
  );
}
