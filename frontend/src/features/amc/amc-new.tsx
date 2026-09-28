"use client";

import { Lock, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { fetcher, type TicketLookups } from "@/features/tickets/api";
import { CustomerPicker, type CustomerOption } from "./customer-picker";
import { amcApi, type BillingUnit } from "./api";
import { BILLING_UNIT_LABELS, BILLING_UNITS } from "./display";

interface MachineOption {
  id: string;
  serialNo: string;
  itemName: string | null;
}

interface EngineerOption {
  id: string;
  name: string;
}

const todayInput = () => new Date().toISOString().slice(0, 10);
const plusYear = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Create an AMC contract. Planned visits aren't part of the create call, so
 * they are added one by one after the contract exists.
 */
export function AmcNewScreen() {
  const router = useRouter();
  const toast = useToast();
  const { can, me } = useSession();
  const canEdit = can("amc.edit");

  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [startsOn, setStartsOn] = useState(todayInput());
  const [endsOn, setEndsOn] = useState(plusYear());
  const [billingUnit, setBillingUnit] = useState<BillingUnit>("FIXED");
  const [value, setValue] = useState("");
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [engineerId, setEngineerId] = useState("");
  const [notes, setNotes] = useState("");
  const [equipmentIds, setEquipmentIds] = useState<string[]>([]);
  const [visitDates, setVisitDates] = useState<string[]>([]);
  const [newVisit, setNewVisit] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const machines = useSWR<{ data: MachineOption[] }>(
    customer && can("equipment.read")
      ? `/equipment?customerId=${customer.id}&pageSize=100`
      : null,
    (key: string) => apiFetch<{ data: MachineOption[] }>(key),
  );
  const lookups = useSWR<TicketLookups>(
    can("tickets.read") ? "/tickets/lookups" : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  const engineers = useSWR<{ data: EngineerOption[] }>(
    can("users.read") ? "/users?status=ACTIVE&pageSize=100" : null,
    (key: string) => apiFetch<{ data: EngineerOption[] }>(key),
  );

  if (me && !canEdit) {
    return (
      <>
        <PageHeader title="New contract" />
        <Card>
          <EmptyState
            icon={<Lock className="size-6" />}
            title="You don't have access to this"
            description="Only people who can edit contracts may create them."
          />
        </Card>
      </>
    );
  }

  const toggleEquipment = (id: string) =>
    setEquipmentIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));

  const addVisitDate = () => {
    if (!newVisit) return;
    if (visitDates.includes(newVisit)) {
      setErrors((e) => ({ ...e, visitDates: "That date is already in the list." }));
      return;
    }
    setVisitDates((dates) => [...dates, newVisit].sort());
    setNewVisit("");
    setErrors((e) => ({ ...e, visitDates: "" }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!customer) next.customerId = "Choose the customer.";
    if (!startsOn) next.startsOn = "Enter the first day of cover.";
    if (!endsOn) next.endsOn = "Enter the last day of cover.";
    if (startsOn && endsOn && endsOn < startsOn)
      next.endsOn = "The last day can't be before the first.";
    if (value.trim() && (Number.isNaN(Number(value)) || Number(value) < 0))
      next.value = "Enter a positive amount.";
    setErrors(next);
    if (Object.keys(next).length > 0 || !customer) return;

    setSaving(true);
    try {
      const created = await amcApi.create({
        customerId: customer.id,
        startsOn,
        endsOn,
        billingUnit,
        value: value.trim() ? Number(value) : undefined,
        serviceTypeId: serviceTypeId || undefined,
        preferredEngineerId: engineerId || undefined,
        notes: notes.trim() || undefined,
        equipmentIds: equipmentIds.length ? equipmentIds : undefined,
      });
      const failed: string[] = [];
      for (const plannedOn of visitDates) {
        try {
          await amcApi.addVisit(created.id, plannedOn);
        } catch {
          failed.push(plannedOn);
        }
      }
      toast.success(`Contract ${created.number} was created.`);
      if (failed.length)
        toast.error(
          `${failed.length} planned ${failed.length === 1 ? "visit" : "visits"} couldn't be saved. Add them from the contract.`,
        );
      router.push(`/amc/${created.id}`);
    } catch (caught) {
      if (caught instanceof ApiError) {
        const fieldErrors: Record<string, string> = {};
        for (const f of caught.fields) fieldErrors[f.field] = f.message;
        if (Object.keys(fieldErrors).length) setErrors(fieldErrors);
        else toast.error(caught.message);
      } else {
        toast.error("Something went wrong. Try again.");
      }
      setSaving(false);
    }
  };

  const serviceTypes = lookups.data?.serviceTypes ?? [];

  return (
    <>
      <PageHeader
        title="New contract"
        description="The annual maintenance contract; planned PM visits become tickets when they're due."
      />
      <Card>
        <CardBody>
          <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-5">
            {customer ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold">
                  Customer{" "}
                  <span className="text-bad" aria-hidden>
                    *
                  </span>
                </span>
                <div className="flex items-center gap-3 rounded-lg border border-line px-3.5 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{customer.name}</span>
                    {customer.territory && (
                      <span className="block text-xs text-muted">{customer.territory}</span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<X className="size-4" aria-hidden />}
                    onClick={() => {
                      setCustomer(null);
                      setEquipmentIds([]);
                    }}
                  >
                    Change
                  </Button>
                </div>
              </div>
            ) : (
              <CustomerPicker error={errors.customerId} onPick={setCustomer} />
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Cover starts" required error={errors.startsOn}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={startsOn}
                    onChange={(e) => setStartsOn(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Cover ends" required error={errors.endsOn}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={endsOn}
                    onChange={(e) => setEndsOn(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Billing" help="How the contract value is charged.">
                {(p) => (
                  <Select
                    {...p}
                    value={billingUnit}
                    onChange={(e) => setBillingUnit(e.target.value as BillingUnit)}
                  >
                    {BILLING_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {BILLING_UNIT_LABELS[unit]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Contract value" error={errors.value} help="In the company currency.">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Service type" help="Used for the PM tickets the contract creates.">
                {(p) => (
                  <Select
                    {...p}
                    value={serviceTypeId}
                    onChange={(e) => setServiceTypeId(e.target.value)}
                    disabled={!can("tickets.read") || lookups.isLoading}
                  >
                    <option value="">None</option>
                    {serviceTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Preferred engineer">
                {(p) => (
                  <Select
                    {...p}
                    value={engineerId}
                    onChange={(e) => setEngineerId(e.target.value)}
                    disabled={!can("users.read")}
                  >
                    <option value="">None</option>
                    {engineers.data?.data.map((engineer) => (
                      <option key={engineer.id} value={engineer.id}>
                        {engineer.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold">Covered machines</span>
              {!customer && (
                <p className="text-xs text-muted">Choose the customer first to see their machines.</p>
              )}
              {customer && machines.isLoading && <Skeleton className="h-16" />}
              {customer && machines.data && (
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {machines.data.data.length === 0 && (
                    <li className="text-[13px] text-muted">
                      This customer has no machines on record.
                    </li>
                  )}
                  {machines.data.data.map((machine) => (
                    <li key={machine.id}>
                      <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3.5 py-2.5 hover:bg-surface-2">
                        <input
                          type="checkbox"
                          checked={equipmentIds.includes(machine.id)}
                          onChange={() => toggleEquipment(machine.id)}
                          className="size-4 accent-(--color-accent)"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">
                            {machine.itemName ?? machine.serialNo}
                          </span>
                          {machine.itemName && (
                            <span className="block font-mono text-xs text-muted">
                              {machine.serialNo}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold">Planned visits</span>
              <p className="text-xs text-muted">
                Agreed PM dates. Each becomes a ticket shortly before it is due.
              </p>
              {visitDates.length > 0 && (
                <ul className="m-0 flex flex-wrap gap-1.5 p-0" aria-label="Planned visit dates">
                  {visitDates.map((date) => (
                    <li
                      key={date}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-[13px]"
                    >
                      {new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                      <button
                        type="button"
                        aria-label={`Remove visit on ${date}`}
                        onClick={() => setVisitDates((dates) => dates.filter((d) => d !== date))}
                        className="cursor-pointer rounded-full p-0.5 text-muted hover:text-bad"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {errors.visitDates && <p className="text-xs font-semibold text-bad">{errors.visitDates}</p>}
              <div className="flex items-end gap-2">
                <div className="max-w-56">
                  <Field label="Visit date">
                    {(p) => (
                      <Input
                        {...p}
                        type="date"
                        value={newVisit}
                        onChange={(e) => setNewVisit(e.target.value)}
                      />
                    )}
                  </Field>
                </div>
                <Button
                  type="button"
                  icon={<Plus className="size-4" aria-hidden />}
                  onClick={addVisitDate}
                  disabled={!newVisit}
                >
                  Add
                </Button>
              </div>
            </div>

            <Field label="Notes" help="Anything the service team should know about this contract.">
              {(p) => (
                <Textarea
                  {...p}
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              )}
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" loading={saving}>
                Create contract
              </Button>
              <Button onClick={() => router.back()}>Cancel</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
