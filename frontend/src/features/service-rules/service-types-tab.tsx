"use client";

import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Drawer } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, TableSkeleton } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { Sub, Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/auth/session";
import { apiFetch, ApiError } from "@/lib/api/client";
import { type Priority, PRIORITY_ORDER, type PriorityRow, type ServiceTypeRow } from "./api";
import { errorsFrom, FormAlert, type FormErrors } from "./shared";

const fetcher = <T,>(key: string) => apiFetch<T>(key);

export function ServiceTypesTab() {
  const canEdit = useSession().can("rules.edit");
  const types = useSWR<ServiceTypeRow[]>("/service-rules/service-types", fetcher);
  const priorities = useSWR<PriorityRow[]>("/service-rules/priorities", fetcher);
  const toast = useToast();
  const [editing, setEditing] = useState<ServiceTypeRow | "new" | null>(null);
  const [busyId, setBusyId] = useState<string>();

  if (types.error)
    return <ErrorState title="Couldn't load service types" onRetry={() => void types.mutate()} />;
  if (!types.data) return <TableSkeleton label="Loading service types" />;

  const priorityLabel = (p: Priority) => priorities.data?.find((r) => r.priority === p)?.label ?? p;

  const toggle = async (row: ServiceTypeRow, active: boolean) => {
    setBusyId(row.id);
    try {
      await apiFetch(`/service-rules/service-types/${row.id}`, {
        method: "PATCH",
        json: { active, version: row.version },
      });
      toast.success(`${row.name} ${active ? "is available again" : "is hidden from new tickets"}.`);
      await types.mutate();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Service types"
        meta="What kind of job a ticket is. Switch one off to hide it from new tickets; old tickets keep it."
        actions={
          canEdit && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => setEditing("new")}
            >
              Add type
            </Button>
          )
        }
      />
      <Table caption="Service types">
        <thead>
          <tr>
            <Th>Type</Th>
            <Th>Default priority</Th>
            <Th>Machine</Th>
            <Th>In use</Th>
          </tr>
        </thead>
        <tbody>
          {types.data.map((t) => (
            <Tr key={t.id}>
              <Td className="min-w-56">
                <button
                  type="button"
                  onClick={() => setEditing(t)}
                  className="cursor-pointer font-semibold text-text underline-offset-2 hover:underline"
                >
                  {t.name}
                </button>
                {t.description && <Sub>{t.description}</Sub>}
              </Td>
              <Td className="whitespace-nowrap">{priorityLabel(t.defaultPriority)}</Td>
              <Td className="whitespace-nowrap">
                {t.requiresEquipment ? (
                  "Required"
                ) : (
                  <StatusPill tone="neutral">Not needed</StatusPill>
                )}
              </Td>
              <Td>
                <Switch
                  disabled={!canEdit}
                  checked={t.active}
                  label={`${t.name} available for new tickets`}
                  busy={busyId === t.id}
                  onChange={(next) => void toggle(t, next)}
                />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <ServiceTypeDrawer
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        type={editing}
        priorities={priorities.data ?? []}
        readOnly={!canEdit}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          toast.success(message);
          setEditing(null);
          await types.mutate();
        }}
      />
    </Card>
  );
}

function ServiceTypeDrawer({
  type,
  priorities,
  onClose,
  onSaved,
  readOnly = false,
}: {
  type: ServiceTypeRow | "new" | null;
  priorities: PriorityRow[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  readOnly?: boolean;
}) {
  const existing = type && type !== "new" ? type : null;
  const [values, setValues] = useState({
    name: existing?.name ?? "",
    description: existing?.description ?? "",
    defaultPriority: existing?.defaultPriority ?? ("MEDIUM" as Priority),
    requiresEquipment: existing?.requiresEquipment ?? true,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (values.name.trim().length < 2) {
      setErrors({ name: "Enter a name." });
      return;
    }
    setSaving(true);
    try {
      if (existing) {
        await apiFetch(`/service-rules/service-types/${existing.id}`, {
          method: "PATCH",
          json: { ...values, version: existing.version },
        });
      } else {
        await apiFetch("/service-rules/service-types", { method: "POST", json: values });
      }
      await onSaved(existing ? `${values.name.trim()} saved.` : `${values.name.trim()} added.`);
    } catch (caught) {
      setErrors(errorsFrom(caught, ["name", "description", "defaultPriority"]));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={!!type}
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : "Add a service type"}
      footer={
        <>
          <Button onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
          {!readOnly && (
            <Button type="submit" form="service-type-form" variant="primary" loading={saving}>
              {existing ? "Save" : "Add type"}
            </Button>
          )}
        </>
      }
    >
      <form id="service-type-form" onSubmit={submit} noValidate>
        <fieldset disabled={readOnly} className="min-w-0 flex flex-col gap-4">
          <FormAlert message={errors.form} />
          <Field label="Name" required error={errors.name}>
            {(p) => (
              <Input
                {...p}
                maxLength={60}
                value={values.name}
                onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              />
            )}
          </Field>
          <Field label="Description" error={errors.description}>
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                maxLength={200}
                value={values.description}
                onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
              />
            )}
          </Field>
          <Field
            label="Default priority"
            error={errors.defaultPriority}
            help="Pre-selected when a ticket of this type is logged."
          >
            {(p) => (
              <Select
                {...p}
                value={values.defaultPriority}
                onChange={(e) =>
                  setValues((v) => ({ ...v, defaultPriority: e.target.value as Priority }))
                }
              >
                {PRIORITY_ORDER.map((key) => (
                  <option key={key} value={key}>
                    {priorities.find((r) => r.priority === key)?.label ?? key}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--accent-strong)]"
              checked={values.requiresEquipment}
              onChange={(e) => setValues((v) => ({ ...v, requiresEquipment: e.target.checked }))}
            />
            <span>
              <span className="block font-semibold">A machine must be chosen</span>
              <span className="text-muted">
                Turn off for jobs like training that aren&apos;t about one machine.
              </span>
            </span>
          </label>
        </fieldset>
      </form>
    </Drawer>
  );
}
