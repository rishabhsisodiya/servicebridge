"use client";

import { CalendarClock, Lock, Plus, ShieldCheck, Wrench, X } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton, Skeleton } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { fetcher, type TicketLookups } from "@/features/tickets/api";
import { useStepUp } from "@/features/auth/use-step-up";
import {
  amcApi,
  type AmcDetail,
  type BillingUnit,
  type AmcEquipmentRow,
} from "./api";
import {
  AmcStatusPill,
  BILLING_UNIT_LABELS,
  BILLING_UNITS,
  contractValue,
  formatDate,
  PlannedVisitStatusPill,
  toDateInput,
} from "./display";

const conflict = (toast: { error: (m: string) => void }, mutate: () => Promise<unknown>) => {
  toast.error("Someone else changed this contract. It's reloaded — try again.");
  void mutate();
};

const fail = (
  caught: unknown,
  toast: { error: (m: string) => void },
  mutate: () => Promise<unknown>,
) => {
  if (caught instanceof ApiError && caught.code === "STEP_UP_CANCELLED") return;
  if (caught instanceof ApiError && caught.code === "VERSION_CONFLICT") {
    conflict(toast, mutate);
    return;
  }
  toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
};

/** Header, lifecycle actions and tabs for one AMC contract. */
export function AmcDetailScreen({ id }: { id: string }) {
  const { can, me } = useSession();
  const toast = useToast();
  const allowed = can("amc.read");
  const { data, error, isLoading, mutate } = useSWR<AmcDetail>(
    allowed ? `/amc/${encodeURIComponent(id)}` : null,
    (key: string) => apiFetch<AmcDetail>(key),
  );
  const [tab, setTab] = useState<"details" | "equipment" | "visits">("details");
  const [activating, setActivating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const stepUp = useStepUp();

  const onError = (caught: unknown) => fail(caught, toast, mutate);

  const activate = async () => {
    if (!data) return;
    setActivating(true);
    try {
      await stepUp.run(() => amcApi.activate(data.id, data.version));
      toast.success(`Contract ${data.number} is active.`);
      await mutate();
    } catch (caught) {
      onError(caught);
    } finally {
      setActivating(false);
    }
  };

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="Contract" />
        <Card>
          <EmptyState
            icon={<Lock className="size-6" />}
            title="You don't have access to this"
            description="Ask your administrator for access to maintenance contracts."
          />
        </Card>
      </>
    );
  }

  const canEdit = can("amc.edit");
  const isDraft = data?.status === "DRAFT";
  const canCancel = data && (data.status === "DRAFT" || data.status === "ACTIVE");

  return (
    <>
      <PageHeader
        title={data?.number ?? "Contract"}
        eyebrow={
          data && (
            <span className="flex flex-wrap items-center gap-2">
              <AmcStatusPill status={data.status} />
              <span className="text-muted">{data.customer.name}</span>
            </span>
          )
        }
        description={
          data
            ? `${formatDate(data.startsOn)} – ${formatDate(data.endsOn)} · ${contractValue(data.value)}`
            : "Loading the contract…"
        }
        actions={
          data &&
          canEdit && (
            <>
              {isDraft && (
                <Button variant="primary" loading={activating} onClick={() => void activate()}>
                  Activate
                </Button>
              )}
              {canCancel && (
                <Button variant="danger" onClick={() => setCancelling(true)}>
                  Cancel…
                </Button>
              )}
            </>
          )
        }
      />

      {isLoading && (
        <Card>
          <TableSkeleton rows={5} label="Loading contract" />
        </Card>
      )}
      {error && !data && (
        <Card>
          <ErrorState
            title="Couldn't load the contract"
            description={error instanceof ApiError ? error.message : undefined}
            onRetry={() => void mutate()}
          />
        </Card>
      )}

      {data && (
        <Tabs
          label="Contract sections"
          value={tab}
          onChange={setTab}
          items={[
            { key: "details", label: "Details" },
            {
              key: "equipment",
              label: "Covered machines",
              count: data.equipment.length,
            },
            {
              key: "visits",
              label: "Planned visits",
              count: data.plannedVisits.length,
            },
          ]}
        >
          {tab === "details" && <DetailsTab contract={data} onError={onError} onSaved={() => void mutate()} />}
          {tab === "equipment" && <EquipmentTab contract={data} onError={onError} onChanged={() => void mutate()} />}
          {tab === "visits" && <VisitsTab contract={data} onError={onError} onChanged={() => void mutate()} />}
        </Tabs>
      )}

      <CancelDialog
        open={cancelling}
        contract={data}
        onClose={() => setCancelling(false)}
        onCancelled={() => {
          setCancelling(false);
          void mutate();
        }}
      />
      {stepUp.dialog}
    </>
  );
}

function CancelDialog({
  open,
  contract,
  onClose,
  onCancelled,
}: {
  open: boolean;
  contract: AmcDetail | undefined;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const toast = useToast();
  const stepUp = useStepUp();
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!contract) return;
    setSaving(true);
    try {
      await stepUp.run(() => amcApi.cancel(contract.id, contract.version));
      toast.success(`Contract ${contract.number} was cancelled.`);
      onCancelled();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "STEP_UP_CANCELLED") {
        /* user changed their mind */
      } else if (caught instanceof ApiError && caught.code === "VERSION_CONFLICT") {
        toast.error("Someone else changed this contract. It's reloaded — try again.");
        onCancelled();
      } else {
        toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={contract ? `Cancel contract ${contract.number}?` : "Cancel contract?"}
      description="The contract stops covering its machines from now. Planned visits are dropped."
      footer={
        <>
          <Button onClick={onClose}>Keep contract</Button>
          <Button type="submit" form="cancel-amc" variant="danger" loading={saving}>
            Cancel contract
          </Button>
        </>
      }
    >
      <form id="cancel-amc" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-[13px] text-muted">
          Cancelling is recorded in the audit log with your name and the time.
        </p>
      </form>
      {stepUp.dialog}
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <dt className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</dt>
      <dd className="m-0 text-[14px]">{children}</dd>
    </div>
  );
}

function DetailsTab({
  contract,
  onError,
  onSaved,
}: {
  contract: AmcDetail;
  onError: (caught: unknown) => void;
  onSaved: () => void;
}) {
  const { can } = useSession();
  const toast = useToast();
  const canEdit = can("amc.edit");
  const [editing, setEditing] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Contract details"
        meta="Cover period, value and people"
        actions={
          canEdit && !editing ? (
            <Button size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        {editing ? (
          <EditDetailsForm
            contract={contract}
            onClose={() => setEditing(false)}
            onError={onError}
            onSaved={() => {
              setEditing(false);
              onSaved();
            }}
          />
        ) : (
          <dl className="m-0 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Row label="Customer">{contract.customer.name}</Row>
            <Row label="Status">
              <AmcStatusPill status={contract.status} />
            </Row>
            <Row label="Cover starts">{formatDate(contract.startsOn)}</Row>
            <Row label="Cover ends">{formatDate(contract.endsOn)}</Row>
            <Row label="Billing">{BILLING_UNIT_LABELS[contract.billingUnit]}</Row>
            <Row label="Contract value">{contractValue(contract.value)}</Row>
            <Row label="Service type">{contract.serviceType?.name ?? "—"}</Row>
            <Row label="Preferred engineer">{contract.preferredEngineer?.name ?? "—"}</Row>
            <Row label="Notes" >
              <span className="whitespace-pre-wrap">{contract.notes ?? "—"}</span>
            </Row>
            <Row label="Last changed">{formatDate(contract.updatedAt)}</Row>
          </dl>
        )}
        {!editing && canEdit && (
          <p className="mt-2 text-xs text-muted">
            To change dates, value, billing or people, choose Edit.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function EditDetailsForm({
  contract,
  onClose,
  onError,
  onSaved,
}: {
  contract: AmcDetail;
  onClose: () => void;
  onSaved: () => void;
  onError: (caught: unknown) => void;
}) {
  const toast = useToast();
  const { can } = useSession();
  const [startsOn, setStartsOn] = useState(toDateInput(contract.startsOn));
  const [endsOn, setEndsOn] = useState(toDateInput(contract.endsOn));
  const [billingUnit, setBillingUnit] = useState<BillingUnit>(contract.billingUnit);
  const [value, setValue] = useState(contract.value ?? "");
  const [serviceTypeId, setServiceTypeId] = useState(contract.serviceTypeId ?? "");
  const [engineerId, setEngineerId] = useState(contract.preferredEngineerId ?? "");
  const [notes, setNotes] = useState(contract.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const lookups = useSWR<TicketLookups>(
    can("tickets.read") ? "/tickets/lookups" : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  const engineers = useSWR<{ data: { id: string; name: string }[] }>(
    can("users.read") ? "/users?status=ACTIVE&pageSize=100" : null,
    (key: string) => apiFetch<{ data: { id: string; name: string }[] }>(key),
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!startsOn) next.startsOn = "Enter the first day of cover.";
    if (!endsOn) next.endsOn = "Enter the last day of cover.";
    if (startsOn && endsOn && endsOn < startsOn)
      next.endsOn = "The last day can't be before the first.";
    if (value.trim() && (Number.isNaN(Number(value)) || Number(value) < 0))
      next.value = "Enter a positive amount.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    try {
      await amcApi.update(contract.id, {
        version: contract.version,
        startsOn,
        endsOn,
        billingUnit,
        value: value.trim() ? Number(value) : null,
        serviceTypeId: serviceTypeId || null,
        preferredEngineerId: engineerId || null,
        notes: notes.trim() ? notes.trim() : null,
      });
      toast.success("Contract details saved.");
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const fieldErrors: Record<string, string> = {};
        for (const f of caught.fields) fieldErrors[f.field] = f.message;
        if (Object.keys(fieldErrors).length) {
          setErrors(fieldErrors);
        } else {
          onError(caught);
        }
      } else {
        onError(caught);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-4">
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
            <Input {...p} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          )}
        </Field>
        <Field label="Billing" error={errors.billingUnit}>
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
        <Field label="Contract value" error={errors.value}>
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
        <Field label="Service type" error={errors.serviceTypeId}>
          {(p) => (
            <Select
              {...p}
              value={serviceTypeId}
              onChange={(e) => setServiceTypeId(e.target.value)}
              disabled={!can("tickets.read")}
            >
              <option value="">None</option>
              {contract.serviceType && !lookups.data && (
                <option value={contract.serviceType.id}>{contract.serviceType.name}</option>
              )}
              {lookups.data?.serviceTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Preferred engineer" error={errors.preferredEngineerId}>
          {(p) => (
            <Select
              {...p}
              value={engineerId}
              onChange={(e) => setEngineerId(e.target.value)}
              disabled={!can("users.read")}
            >
              <option value="">None</option>
              {contract.preferredEngineer && !engineers.data && (
                <option value={contract.preferredEngineer.id}>
                  {contract.preferredEngineer.name}
                </option>
              )}
              {engineers.data?.data.map((engineer) => (
                <option key={engineer.id} value={engineer.id}>
                  {engineer.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Notes" error={errors.notes}>
        {(p) => (
          <Textarea {...p} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" loading={saving}>
          Save changes
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

function EquipmentTab({
  contract,
  onError,
  onChanged,
}: {
  contract: AmcDetail;
  onError: (caught: unknown) => void;
  onChanged: () => void;
}) {
  const { can } = useSession();
  const toast = useToast();
  const canEdit = can("amc.edit");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const covered = new Set(contract.equipment.map((e) => e.equipmentId));

  const remove = async (row: AmcEquipmentRow) => {
    setBusy(row.equipmentId);
    try {
      await amcApi.removeEquipment(contract.id, row.equipmentId);
      toast.success(`${row.equipment.itemName ?? row.equipment.serialNo} removed from the contract.`);
      onChanged();
    } catch (caught) {
      onError(caught);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Covered machines"
        meta={`${contract.equipment.length} ${contract.equipment.length === 1 ? "machine" : "machines"} under this contract`}
        actions={
          canEdit ? (
            <Button
              size="sm"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => setAdding((v) => !v)}
              aria-expanded={adding}
            >
              {adding ? "Close" : "Add machines"}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="flex flex-col gap-4">
        {adding && (
          <AddEquipmentForm
            contract={contract}
            covered={covered}
            onError={onError}
            onChanged={() => {
              setAdding(false);
              onChanged();
            }}
          />
        )}
        {contract.equipment.length === 0 ? (
          <EmptyState
            icon={<Wrench className="size-6" aria-hidden />}
            title="No machines covered yet"
            description={
              canEdit
                ? "Add this customer's machines so their breakdowns are covered."
                : "This contract doesn't cover any machines yet."
            }
          />
        ) : (
          <Table caption="Covered machines">
            <thead>
              <tr>
                <Th>Machine</Th>
                <Th>Serial number</Th>
                {canEdit && (
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                )}
              </tr>
            </thead>
            <tbody>
              {contract.equipment.map((row) => (
                <Tr key={row.equipmentId}>
                  <Td>{row.equipment.itemName ?? "—"}</Td>
                  <Td className="font-mono">{row.equipment.serialNo}</Td>
                  {canEdit && (
                    <Td align="right">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<X className="size-4" aria-hidden />}
                        loading={busy === row.equipmentId}
                        onClick={() => void remove(row)}
                      >
                        Remove
                      </Button>
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

function AddEquipmentForm({
  contract,
  covered,
  onError,
  onChanged,
}: {
  contract: AmcDetail;
  covered: Set<string>;
  onError: (caught: unknown) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { can } = useSession();
  const machines = useSWR<{ data: { id: string; serialNo: string; itemName: string | null }[] }>(
    can("equipment.read") ? `/equipment?customerId=${contract.customer.id}&pageSize=100` : null,
    (key: string) =>
      apiFetch<{ data: { id: string; serialNo: string; itemName: string | null }[] }>(key),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const available = (machines.data?.data ?? []).filter((m) => !covered.has(m.id));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (selected.length === 0) return;
    setSaving(true);
    try {
      for (const equipmentId of selected) {
        await amcApi.addEquipment(contract.id, equipmentId);
      }
      toast.success(
        `${selected.length} ${selected.length === 1 ? "machine" : "machines"} added to the contract.`,
      );
      onChanged();
    } catch (caught) {
      onError(caught);
    } finally {
      setSaving(false);
    }
  };

  if (!can("equipment.read")) {
    return <p className="text-[13px] text-muted">You need equipment access to add machines.</p>;
  }
  if (machines.isLoading) return <Skeleton className="h-16" />;
  if (available.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        Every machine of this customer is already covered by this contract.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {available.map((machine) => (
          <li key={machine.id}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3.5 py-2 text-[13px] hover:bg-surface-2">
              <input
                type="checkbox"
                checked={selected.includes(machine.id)}
                onChange={() =>
                  setSelected((ids) =>
                    ids.includes(machine.id)
                      ? ids.filter((i) => i !== machine.id)
                      : [...ids, machine.id],
                  )
                }
                className="size-4 accent-(--color-accent)"
              />
              <span className="font-semibold">{machine.itemName ?? machine.serialNo}</span>
              {machine.itemName && (
                <span className="font-mono text-xs text-muted">{machine.serialNo}</span>
              )}
            </label>
          </li>
        ))}
      </ul>
      <div>
        <Button type="submit" size="sm" variant="primary" loading={saving} disabled={selected.length === 0}>
          Add {selected.length > 0 ? `${selected.length} ` : ""}selected
        </Button>
      </div>
    </form>
  );
}

function VisitsTab({
  contract,
  onError,
  onChanged,
}: {
  contract: AmcDetail;
  onError: (caught: unknown) => void;
  onChanged: () => void;
}) {
  const { can } = useSession();
  const toast = useToast();
  const canEdit = can("amc.edit");
  const [plannedOn, setPlannedOn] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!plannedOn) {
      setError("Pick the visit date.");
      return;
    }
    setSaving(true);
    try {
      await amcApi.addVisit(contract.id, plannedOn, equipmentId || undefined);
      toast.success("Planned visit added.");
      setPlannedOn("");
      setEquipmentId("");
      setError(undefined);
      onChanged();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code !== "VERSION_CONFLICT") {
        setError(caught.fieldMessage("plannedOn") ?? caught.message);
      } else {
        onError(caught);
      }
    } finally {
      setSaving(false);
    }
  };

  /** Removes a planned visit. Only PLANNED visits can be removed; the backend rejects the rest. */
  const remove = async (visitId: string) => {
    setRemoving(visitId);
    try {
      await amcApi.removeVisit(contract.id, visitId);
      toast.success("Planned visit removed.");
      onChanged();
    } catch (caught) {
      onError(caught);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Planned visits"
        meta="Agreed PM dates — each becomes a ticket shortly before it is due"
      />
      <CardBody className="flex flex-col gap-4">
        {canEdit && (
          <form
            onSubmit={submit}
            noValidate
            className="flex flex-wrap items-end gap-2.5 rounded-lg border border-line bg-surface-2/50 px-3.5 py-3"
          >
            <div className="max-w-56 flex-1">
              <Field label="Visit date" required error={error}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={plannedOn}
                    onChange={(e) => setPlannedOn(e.target.value)}
                  />
                )}
              </Field>
            </div>
            {contract.equipment.length > 0 && (
              <div className="max-w-72 flex-1">
                <Field label="Machine (optional)">
                  {(p) => (
                    <Select
                      {...p}
                      value={equipmentId}
                      onChange={(e) => setEquipmentId(e.target.value)}
                    >
                      <option value="">Whole contract</option>
                      {contract.equipment.map((row) => (
                        <option key={row.equipmentId} value={row.equipmentId}>
                          {row.equipment.itemName ?? row.equipment.serialNo}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            )}
            <Button
              type="submit"
              icon={<Plus className="size-4" aria-hidden />}
              loading={saving}
              disabled={!plannedOn}
            >
              Add visit
            </Button>
          </form>
        )}
        {contract.plannedVisits.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="size-6" aria-hidden />}
            title="No visits planned yet"
            description={
              canEdit
                ? "Add the agreed PM dates and each becomes a ticket when it is due."
                : "This contract has no planned PM visits yet."
            }
          />
        ) : (
          <Table caption="Planned visits">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th>Machine</Th>
                {canEdit && (
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                )}
              </tr>
            </thead>
            <tbody>
              {contract.plannedVisits.map((visit) => {
                const machine = visit.equipmentId
                  ? contract.equipment.find((e) => e.equipmentId === visit.equipmentId)
                  : undefined;
                return (
                  <Tr key={visit.id}>
                    <Td className="whitespace-nowrap">{formatDate(visit.plannedOn)}</Td>
                    <Td>
                      <PlannedVisitStatusPill status={visit.status} />
                    </Td>
                    <Td>
                      {machine
                        ? (machine.equipment.itemName ?? machine.equipment.serialNo)
                        : visit.equipmentId
                          ? <span className="text-muted">Machine removed</span>
                          : <span className="text-muted">Whole contract</span>}
                    </Td>
                    {canEdit && (
                      <Td align="right">
                        {visit.status === "PLANNED" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<X className="size-4" aria-hidden />}
                            loading={removing === visit.id}
                            onClick={() => void remove(visit.id)}
                          >
                            Remove
                          </Button>
                        ) : (
                          <span className="text-xs text-muted">Locked</span>
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
  );
}
