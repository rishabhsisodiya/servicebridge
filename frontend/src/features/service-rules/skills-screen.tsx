"use client";

import { Lock, Plus, Tags, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, Drawer } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Sub, Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { SourceTag } from "@/features/catalog/shared";
import type { SkillOptions, SkillRow } from "./api";
import { errorsFrom, FormAlert, type FormErrors } from "./shared";

const KEY = "/skills";

export function SkillsScreen() {
  const { can, me } = useSession();
  const allowed = can("rules.read");
  const skills = useSWR<SkillRow[]>(allowed ? KEY : null, (k: string) => apiFetch<SkillRow[]>(k));
  const toast = useToast();
  const [editing, setEditing] = useState<SkillRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<SkillRow | null>(null);
  const [deleteError, setDeleteError] = useState<string>();

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="Skill tags" />
        <Card>
          <EmptyState icon={<Lock className="size-6" />} title="You don't have access to this" />
        </Card>
      </>
    );
  }

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiFetch(`${KEY}/${deleting.id}`, { method: "DELETE" });
      toast.success(`${deleting.name} deleted.`);
      setDeleting(null);
      await skills.mutate();
    } catch (caught) {
      setDeleteError(
        caught instanceof ApiError ? caught.message : "Something went wrong. Try again.",
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Skill tags"
        description="Which machines need which skill, and who has it. Used to suggest engineers for a ticket."
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => setEditing("new")}
          >
            Add skill
          </Button>
        }
      />
      <Card>
        {skills.error && (
          <ErrorState title="Couldn't load skills" onRetry={() => void skills.mutate()} />
        )}
        {!skills.data && !skills.error && <TableSkeleton label="Loading skills" />}
        {skills.data?.length === 0 && (
          <EmptyState
            icon={<Tags className="size-6" />}
            title="No skills yet"
            description="Add a skill, choose the machine models that need it, and tag the engineers who have it."
          />
        )}
        {skills.data && skills.data.length > 0 && (
          <Table caption="Skill tags">
            <thead>
              <tr>
                <Th>Skill</Th>
                <Th>Machine models</Th>
                <Th>Engineers</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {skills.data.map((s) => (
                <Tr key={s.id}>
                  <Td className="min-w-56">
                    <span className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(s)}
                        className="cursor-pointer font-semibold text-text underline-offset-2 hover:underline"
                      >
                        {s.name}
                      </button>
                      {s.isDemo && <SourceTag source="DEMO" />}
                    </span>
                    {s.description && <Sub>{s.description}</Sub>}
                  </Td>
                  <Td className="min-w-40 font-mono text-[13px]">
                    {s.equipmentModels.join(", ") || (
                      <span className="font-sans text-muted">None</span>
                    )}
                  </Td>
                  <Td className="min-w-48">
                    {s.engineers.length ? (
                      s.engineers.map((e) => e.name).join(", ")
                    ) : (
                      <span className="text-muted">Nobody yet</span>
                    )}
                  </Td>
                  <Td align="right">
                    <IconButton
                      label={`Delete ${s.name}`}
                      size="sm"
                      onClick={() => {
                        setDeleteError(undefined);
                        setDeleting(s);
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </IconButton>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <SkillDrawer
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        skill={editing}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          toast.success(message);
          setEditing(null);
          await skills.mutate();
        }}
      />
      <Dialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? "skill"}?`}
        description="Engineers lose this tag. Tickets already assigned are not affected."
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      >
        <FormAlert message={deleteError} />
      </Dialog>
    </>
  );
}

function CheckList<T extends string>({
  legend,
  items,
  selected,
  onToggle,
  empty,
}: {
  legend: string;
  items: { value: T; label: string; hint?: string }[];
  selected: Set<T>;
  onToggle: (value: T) => void;
  empty: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-[13px] font-semibold">{legend}</legend>
      {items.length === 0 && <p className="text-[13px] text-muted">{empty}</p>}
      <div className="flex max-h-64 flex-col overflow-y-auto rounded-lg border border-line">
        {items.map((item) => (
          <label
            key={item.value}
            className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 text-[13px] last:border-b-0 hover:bg-surface-2"
          >
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent-strong)]"
              checked={selected.has(item.value)}
              onChange={() => onToggle(item.value)}
            />
            <span className="min-w-0 flex-1">{item.label}</span>
            {item.hint && <span className="text-xs text-muted">{item.hint}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SkillDrawer({
  skill,
  onClose,
  onSaved,
}: {
  skill: SkillRow | "new" | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const existing = skill && skill !== "new" ? skill : null;
  const options = useSWR<SkillOptions>(skill ? `${KEY}/options` : null, (k: string) =>
    apiFetch<SkillOptions>(k),
  );
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [models, setModels] = useState(new Set(existing?.equipmentModels ?? []));
  const [engineers, setEngineers] = useState(new Set(existing?.engineers.map((e) => e.id) ?? []));
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const toggle = (set: Set<string>, update: (next: Set<string>) => void) => (value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  // Models saved earlier but no longer on any machine stay visible so they can be removed.
  const knownModels = options.data?.models ?? [];
  const modelItems = [
    ...knownModels.map((m) => ({
      value: m.code,
      label: m.name ? `${m.code} · ${m.name}` : m.code,
      hint: `${m.machineCount} ${m.machineCount === 1 ? "machine" : "machines"}`,
    })),
    ...[...models]
      .filter((code) => !knownModels.some((m) => m.code === code))
      .map((code) => ({ value: code, label: code, hint: "no machines" })),
  ];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) {
      setErrors({ name: "Enter a name." });
      return;
    }
    setSaving(true);
    const json = { name, description, equipmentModels: [...models], userIds: [...engineers] };
    try {
      if (existing) {
        await apiFetch(`${KEY}/${existing.id}`, {
          method: "PATCH",
          json: { ...json, version: existing.version },
        });
      } else {
        await apiFetch(KEY, { method: "POST", json });
      }
      await onSaved(existing ? `${name.trim()} saved.` : `${name.trim()} added.`);
    } catch (caught) {
      setErrors(errorsFrom(caught, ["name", "description", "equipmentModels", "userIds"]));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={!!skill}
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : "Add a skill"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="skill-form" variant="primary" loading={saving}>
            {existing ? "Save" : "Add skill"}
          </Button>
        </>
      }
    >
      <form id="skill-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormAlert message={errors.form ?? errors.equipmentModels ?? errors.userIds} />
        <Field label="Name" required error={errors.name}>
          {(p) => (
            <Input {...p} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field label="Description" error={errors.description}>
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        {options.error && (
          <ErrorState
            title="Couldn't load models and engineers"
            onRetry={() => void options.mutate()}
          />
        )}
        {options.isLoading && <TableSkeleton rows={4} label="Loading models and engineers" />}
        {options.data && (
          <>
            <CheckList
              legend="Machine models that need this skill"
              items={modelItems}
              selected={models}
              onToggle={toggle(models, setModels)}
              empty="No machines yet. Models appear here once machines are synced from the ERP or loaded as demo data."
            />
            <CheckList
              legend="Engineers with this skill"
              items={options.data.engineers.map((e) => ({
                value: e.id,
                label: e.name,
                hint: e.region ?? undefined,
              }))}
              selected={engineers}
              onToggle={toggle(engineers, setEngineers)}
              empty="No engineers yet. Invite them under Users & roles."
            />
          </>
        )}
      </form>
    </Drawer>
  );
}
