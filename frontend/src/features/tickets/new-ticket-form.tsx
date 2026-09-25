"use client";

import { AlertTriangle, Building2, Lock, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SearchInput } from "@/components/ui/list-controls";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { CoveragePill, type Coverage as CatalogCoverage } from "@/features/catalog/shared";
import {
  CHANNEL_LABEL,
  type Channel,
  fetcher,
  type TicketRow,
  useTicketLabels,
  useTicketLookups,
} from "./api";
import { type Priority, PRIORITY_ORDER } from "./display";

interface CustomerOption {
  id: string;
  name: string;
  territory: string | null;
  machineCount: number;
}

interface CustomerDetail {
  id: string;
  name: string;
  sites: {
    id: string;
    title: string;
    city: string | null;
    pincode: string | null;
    active: boolean;
  }[];
  contacts: {
    id: string;
    fullName: string;
    mobile: string | null;
    isPrimary: boolean;
    active: boolean;
  }[];
  equipment: {
    id: string;
    serialNo: string;
    itemName: string | null;
    itemCode: string | null;
    active: boolean;
    coverage: CatalogCoverage;
    until: string | null;
    amcExpiring: boolean;
  }[];
}

type Errors = Record<string, string | undefined>;
const FIELDS = [
  "customerId",
  "siteId",
  "equipmentId",
  "contactId",
  "serviceTypeId",
  "priority",
  "channel",
  "title",
  "description",
] as const;

const CHANNELS = Object.keys(CHANNEL_LABEL).filter((c) => c !== "PARTNER") as Channel[];

export function NewTicketForm({ initialCustomerId }: { initialCustomerId?: string }) {
  const { can, me } = useSession();
  const router = useRouter();
  const toast = useToast();
  const lookups = useTicketLookups();
  const labels = useTicketLabels();

  const [customerId, setCustomerId] = useState(initialCustomerId ?? "");
  const [siteId, setSiteId] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [contactId, setContactId] = useState("");
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [priority, setPriority] = useState<Priority | "">("");
  const [channel, setChannel] = useState<Channel>("PHONE");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const customer = useSWR<CustomerDetail>(customerId ? `/customers/${customerId}` : null, fetcher, {
    onSuccess: (c) => {
      // Sensible defaults once the customer is known; the user can change them.
      const sites = c.sites.filter((s) => s.active);
      setSiteId((current) => current || (sites.length === 1 ? sites[0].id : ""));
      setContactId(
        (current) => current || (c.contacts.find((p) => p.isPrimary && p.active)?.id ?? ""),
      );
    },
  });
  const duplicates = useSWR<TicketRow[]>(
    equipmentId ? `/tickets/duplicates?equipmentId=${equipmentId}` : null,
    fetcher,
  );

  const serviceType = lookups.data?.serviceTypes.find((t) => t.id === serviceTypeId);
  const machine = customer.data?.equipment.find((m) => m.id === equipmentId);
  const openDuplicates = duplicates.data ?? [];

  const pickCustomer = (id: string) => {
    setCustomerId(id);
    setSiteId("");
    setEquipmentId("");
    setContactId("");
    setAcknowledged(false);
    setErrors({});
  };

  if (me && !can("tickets.create")) {
    return (
      <>
        <PageHeader title="Log a ticket" />
        <Card>
          <EmptyState icon={<Lock className="size-6" />} title="You don't have access to this" />
        </Card>
      </>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Errors = {};
    if (!customerId) next.customerId = "Choose the customer.";
    if (!serviceTypeId) next.serviceTypeId = "Choose a service type.";
    if (serviceType?.requiresEquipment && !equipmentId)
      next.equipmentId = `Choose the machine. ${serviceType.name} tickets need one.`;
    if (title.trim().length < 5)
      next.title = "Describe the problem in a few words (at least 5 characters).";
    if (openDuplicates.length && !acknowledged)
      next.duplicates = "Confirm this is a different problem, or open the existing ticket.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      const created = await apiFetch<{ number: string }>("/tickets", {
        method: "POST",
        json: {
          customerId,
          siteId: siteId || undefined,
          equipmentId: equipmentId || undefined,
          contactId: contactId || undefined,
          serviceTypeId,
          priority: priority || undefined,
          channel,
          title,
          description: description.trim() || undefined,
          acknowledgeDuplicates: acknowledged || undefined,
        },
      });
      toast.success(`Ticket ${created.number} logged.`);
      router.push(`/tickets/${created.number}`);
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : undefined;
      const fieldErrors: Errors = {};
      for (const field of FIELDS) fieldErrors[field] = apiError?.fieldMessage(field);
      if (apiError?.code === "DUPLICATE_SUSPECTED") {
        fieldErrors.duplicates = apiError.message;
        void duplicates.mutate();
      } else if (!FIELDS.some((f) => fieldErrors[f])) {
        fieldErrors.form = apiError?.message ?? "Something went wrong. Try again.";
      }
      setErrors(fieldErrors);
      setSaving(false);
    }
  };

  const activeSites = customer.data?.sites.filter((s) => s.active || s.id === siteId) ?? [];
  const activeContacts =
    customer.data?.contacts.filter((c) => c.active || c.id === contactId) ?? [];
  const activeMachines =
    customer.data?.equipment.filter((m) => m.active || m.id === equipmentId) ?? [];

  return (
    <>
      <PageHeader
        title="Log a ticket"
        description="Coverage and SLA targets are worked out from the machine. The ticket is routed to the area manager for the site's pincode."
      />
      <Card className="max-w-3xl">
        <CardBody>
          <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            {errors.form && (
              <p role="alert" className="rounded-lg bg-bad-bg px-3.5 py-2.5 text-[13px] text-bad">
                {errors.form}
              </p>
            )}

            <fieldset className="flex flex-col gap-4">
              <legend className="mb-2 text-[15px] font-semibold">Customer and machine</legend>
              {customerId ? (
                <div className="flex items-center gap-3 rounded-lg border border-line px-3.5 py-2.5">
                  <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 font-semibold">
                    {customer.data?.name ?? (customer.error ? "Customer not found" : "Loading…")}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<X className="size-4" aria-hidden />}
                    onClick={() => pickCustomer("")}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <CustomerPicker error={errors.customerId} onPick={pickCustomer} />
              )}
              {customer.error && (
                <ErrorState
                  title="Couldn't load this customer"
                  onRetry={() => void customer.mutate()}
                />
              )}
              {customerId && !customer.data && !customer.error && <Skeleton className="h-24" />}

              {customer.data && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    label="Machine"
                    required={serviceType?.requiresEquipment}
                    error={errors.equipmentId}
                    className="sm:col-span-2"
                    help={
                      activeMachines.length
                        ? undefined
                        : "No machines are recorded for this customer."
                    }
                  >
                    {(p) => (
                      <Select
                        {...p}
                        value={equipmentId}
                        onChange={(e) => {
                          setEquipmentId(e.target.value);
                          setAcknowledged(false);
                        }}
                      >
                        <option value="">No specific machine</option>
                        {activeMachines.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.serialNo} · {m.itemName ?? m.itemCode ?? "Unknown model"}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  {machine && (
                    <div className="flex items-center gap-2 text-[13px] sm:col-span-2">
                      <span className="text-muted">Coverage:</span>
                      <CoveragePill
                        coverage={machine.coverage}
                        until={machine.until}
                        amcExpiring={machine.amcExpiring}
                      />
                    </div>
                  )}
                  {openDuplicates.length > 0 && (
                    <div
                      role="alert"
                      className="flex flex-col gap-2 rounded-lg bg-warn-bg px-3.5 py-3 text-[13px] sm:col-span-2"
                    >
                      <p className="flex items-center gap-2 font-semibold text-warn">
                        <AlertTriangle className="size-4 shrink-0" aria-hidden />
                        This machine already has{" "}
                        {openDuplicates.length === 1
                          ? "an open ticket"
                          : `${openDuplicates.length} open tickets`}
                      </p>
                      <ul className="m-0 list-none p-0 text-text">
                        {openDuplicates.map((t) => (
                          <li key={t.id}>
                            <Link
                              href={`/tickets/${t.number}`}
                              className="font-mono font-semibold underline-offset-2 hover:underline"
                            >
                              {t.number}
                            </Link>{" "}
                            · {t.title} · {labels.stage(t.stage)}
                          </li>
                        ))}
                      </ul>
                      <label className="flex cursor-pointer items-start gap-2.5 text-text">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          onChange={(e) => setAcknowledged(e.target.checked)}
                          className="mt-0.5 size-4 accent-[var(--accent-strong)]"
                        />
                        It&apos;s a different problem — log a new ticket anyway
                      </label>
                      {errors.duplicates && (
                        <p className="font-semibold text-bad">{errors.duplicates}</p>
                      )}
                    </div>
                  )}
                  <Field
                    label="Site"
                    error={errors.siteId}
                    help="Decides the region and area manager."
                  >
                    {(p) => (
                      <Select {...p} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                        <option value="">
                          {activeSites.length ? "Choose a site" : "No sites recorded"}
                        </option>
                        {activeSites.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                            {s.city ? ` · ${s.city}` : ""}
                            {s.pincode ? ` · ${s.pincode}` : ""}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Contact" error={errors.contactId}>
                    {(p) => (
                      <Select
                        {...p}
                        value={contactId}
                        onChange={(e) => setContactId(e.target.value)}
                      >
                        <option value="">No contact</option>
                        {activeContacts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.fullName}
                            {c.mobile ? ` · ${c.mobile}` : ""}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
              )}
            </fieldset>

            <fieldset className="flex flex-col gap-4">
              <legend className="mb-2 text-[15px] font-semibold">The request</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Service type" required error={errors.serviceTypeId}>
                  {(p) => (
                    <Select
                      {...p}
                      value={serviceTypeId}
                      onChange={(e) => setServiceTypeId(e.target.value)}
                    >
                      <option value="">{lookups.isLoading ? "Loading…" : "Choose a type"}</option>
                      {lookups.data?.serviceTypes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Priority" error={errors.priority}>
                  {(p) => (
                    <Select
                      {...p}
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as Priority | "")}
                    >
                      <option value="">
                        {serviceType
                          ? `Default (${labels.priority(serviceType.defaultPriority)})`
                          : "Default for the type"}
                      </option>
                      {PRIORITY_ORDER.map((key) => (
                        <option key={key} value={key}>
                          {labels.priority(key)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Came in by" required error={errors.channel}>
                  {(p) => (
                    <Select
                      {...p}
                      value={channel}
                      onChange={(e) => setChannel(e.target.value as Channel)}
                    >
                      {CHANNELS.map((c) => (
                        <option key={c} value={c}>
                          {CHANNEL_LABEL[c]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              {serviceType?.description && (
                <p className="-mt-2 text-xs text-muted">{serviceType.description}</p>
              )}
              <Field
                label="Problem summary"
                required
                error={errors.title}
                help="A short line, e.g. “Toggle plate cracked, plant stopped”."
              >
                {(p) => (
                  <Input
                    {...p}
                    maxLength={140}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Details"
                error={errors.description}
                help="What the caller described, error codes, when it started."
              >
                {(p) => (
                  <Textarea
                    {...p}
                    rows={4}
                    maxLength={5000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                )}
              </Field>
            </fieldset>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" loading={saving}>
                Log ticket
              </Button>
              <Button onClick={() => router.back()}>Cancel</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}

function CustomerPicker({ error, onPick }: { error?: string; onPick: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const onSearch = useCallback((value: string) => setSearch(value), []);
  const results = useSWR<{ data: CustomerOption[] }>(
    search.length >= 2 ? `/customers?search=${encodeURIComponent(search)}&pageSize=8` : null,
    fetcher,
    { keepPreviousData: true },
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold">
        Customer{" "}
        <span className="text-bad" aria-hidden>
          *
        </span>
      </span>
      <SearchInput
        label="Find the customer"
        placeholder="Customer name, GSTIN or phone"
        onChange={onSearch}
      />
      {error && <p className="text-xs font-semibold text-bad">{error}</p>}
      {search.length >= 2 && (
        <ul
          aria-label="Matching customers"
          className="m-0 list-none overflow-hidden rounded-lg border border-line p-0"
        >
          {results.data?.data.length === 0 && (
            <li className="px-3.5 py-2.5 text-[13px] text-muted">No customers match.</li>
          )}
          {results.error && (
            <li className="px-3.5 py-2.5 text-[13px] text-bad">Couldn&apos;t search customers.</li>
          )}
          {results.data?.data.map((c) => (
            <li key={c.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => onPick(c.id)}
                className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-2 focus-visible:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{c.name}</span>
                  {c.territory && <span className="block text-xs text-muted">{c.territory}</span>}
                </span>
                <span className="text-xs text-muted">
                  {c.machineCount} {c.machineCount === 1 ? "machine" : "machines"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
