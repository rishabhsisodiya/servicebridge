"use client";

import { Lock } from "lucide-react";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { TicketScope } from "@/lib/auth/session";
import { errorsFrom, FormAlert, type FormErrors } from "@/features/service-rules/shared";
import type { Catalog, RoleDetail, RoleInput, RoleRow } from "./api";
import { ALL_OPS, OP_LABELS, toggle } from "./grid";

interface RoleDrawerProps {
  /** The role being edited, "new", or null when closed. */
  role: RoleRow | "new" | null;
  roles: RoleRow[];
  catalog: Catalog;
  /** False shows the role read-only (no Edit or Create permission on roles). */
  canSave: boolean;
  onClose: () => void;
  onSave: (input: RoleInput) => Promise<void>;
}

const checkbox = "size-4 accent-[var(--accent-strong)] disabled:cursor-not-allowed";

/** Create, edit or view a role: name, ticket visibility, record grid and workflow actions. */
export function RoleDrawer({ role, roles, catalog, canSave, onClose, onSave }: RoleDrawerProps) {
  const existing = role && role !== "new" ? role : null;
  const readOnly = !canSave || !!existing?.isLocked;
  const detail = useSWR<RoleDetail>(existing ? `/roles/${existing.id}` : null, (k: string) =>
    apiFetch<RoleDetail>(k),
  );

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [scope, setScope] = useState<TicketScope | "">(existing?.ticketScope ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(existing?.permissions ?? []));
  const [copyFrom, setCopyFrom] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const flip = (permission: string) => setSelected((s) => toggle(s, permission, catalog));

  // Unsaved edits: Escape / backdrop / close asks "Discard changes?" first.
  const initialPermissions = new Set<string>(existing?.permissions ?? []);
  const dirty =
    name !== (existing?.name ?? "") ||
    description !== (existing?.description ?? "") ||
    scope !== (existing?.ticketScope ?? "") ||
    selected.size !== initialPermissions.size ||
    [...selected].some((p) => !initialPermissions.has(p));

  const copy = (id: string) => {
    setCopyFrom(id);
    const source = roles.find((r) => r.id === id);
    if (!source) return;
    setSelected(new Set(source.permissions));
    setScope(source.ticketScope);
  };

  // People stop being engineers when "Work on tickets" is removed from a role they hold.
  const losesEngineers =
    !!existing?.permissions.includes("tickets.work") &&
    !selected.has("tickets.work") &&
    existing.userCount > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: FormErrors = {};
    if (name.trim().length < 2) next.name = "Enter a role name.";
    if (!scope) next.ticketScope = "Choose which tickets people with this role can see.";
    setErrors(next);
    if (Object.keys(next).length || !scope) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || null,
        ticketScope: scope,
        permissions: [...selected],
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "STEP_UP_CANCELLED") return;
      setErrors(errorsFrom(caught, ["name", "description", "ticketScope", "permissions"]));
    } finally {
      setSaving(false);
    }
  };

  const title = existing ? (readOnly ? existing.name : `Edit ${existing.name}`) : "New role";

  return (
    <Drawer
      open={!!role}
      onClose={onClose}
      dirty={dirty && !readOnly}
      className="w-[min(640px,100vw)]"
      title={title}
      description={
        existing
          ? `${existing.userCount} ${existing.userCount === 1 ? "person has" : "people have"} this role. Changes apply straight away.`
          : "Choose what people with this role can see and do."
      }
      footer={
        readOnly ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" form="role-form" variant="primary" loading={saving}>
              {existing ? "Save role" : "Create role"}
            </Button>
          </>
        )
      }
    >
      <form id="role-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
        <FormAlert message={errors.form ?? errors.permissions} />
        {existing?.isLocked && (
          <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3.5 py-2.5 text-[13px]">
            <Lock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            Administrators can do everything and see every ticket. This role can&apos;t be changed.
            They aren&apos;t engineers and don&apos;t get escalation alerts unless you give them
            another role.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name}>
            {(p) => (
              <Input
                {...p}
                maxLength={50}
                readOnly={readOnly}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          {!existing && (
            <Field label="Start from" help="Copies its permissions and ticket visibility.">
              {(p) => (
                <Select {...p} value={copyFrom} onChange={(e) => copy(e.target.value)}>
                  <option value="">Blank role</option>
                  {roles
                    .filter((r) => !r.isLocked)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        <Field label="Description" error={errors.description}>
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              maxLength={200}
              readOnly={readOnly}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>

        <fieldset className="flex flex-col gap-1.5" aria-describedby="scope-error">
          <legend className="mb-1 text-[13px] font-semibold">
            Which tickets can they see?{" "}
            <span className="text-bad" aria-hidden>
              *
            </span>
          </legend>
          <div className="flex flex-col rounded-lg border border-line">
            {catalog.scopes.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-2.5 border-b border-line px-3 py-2.5 text-[13px] last:border-b-0 hover:bg-surface-2 has-disabled:cursor-default"
              >
                <input
                  type="radio"
                  name="ticketScope"
                  className={`${checkbox} mt-0.5`}
                  checked={scope === option.value}
                  disabled={readOnly}
                  onChange={() => setScope(option.value)}
                />
                <span>
                  <span className="block font-semibold">{option.label}</span>
                  <span className="block text-muted">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.ticketScope && (
            <p id="scope-error" className="text-[13px] text-bad">
              {errors.ticketScope}
            </p>
          )}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <h3 id="records-heading" className="text-[13px] font-semibold">
            Records
          </h3>
          <p className="text-[13px] text-muted">
            Anything beyond Read also turns on Read. Dashes mean the action doesn&apos;t apply.
          </p>
          <div className="relative overflow-x-auto rounded-lg border border-line">
            <table aria-labelledby="records-heading" className="w-full border-collapse text-[13px]">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Record
                  </th>
                  {ALL_OPS.map((op) => (
                    <th key={op} scope="col" className="w-16 px-1 py-2 text-center font-semibold">
                      {OP_LABELS[op]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {catalog.records.map((record) => (
                  <tr key={record.key} className="border-t border-line">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <span className="block font-semibold">{record.label}</span>
                      {record.hint && (
                        <span className="block text-xs text-muted">{record.hint}</span>
                      )}
                    </th>
                    {ALL_OPS.map((op) => {
                      const permission = `${record.key}.${op}`;
                      return (
                        <td key={op} className="px-1 py-2 text-center">
                          {record.ops.includes(op) ? (
                            <input
                              type="checkbox"
                              className={checkbox}
                              aria-label={`${record.label}: ${OP_LABELS[op]}`}
                              checked={selected.has(permission)}
                              disabled={readOnly}
                              onChange={() => flip(permission)}
                            />
                          ) : (
                            <span className="text-faint">
                              <span aria-hidden>—</span>
                              <span className="sr-only">Not applicable</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-semibold">Workflow actions</legend>
          <div className="flex flex-col rounded-lg border border-line">
            {catalog.actions.map((action) => (
              <label
                key={action.key}
                className="flex cursor-pointer items-start gap-2.5 border-b border-line px-3 py-2.5 text-[13px] last:border-b-0 hover:bg-surface-2 has-disabled:cursor-default"
              >
                <input
                  type="checkbox"
                  className={`${checkbox} mt-0.5`}
                  checked={selected.has(action.key)}
                  disabled={readOnly}
                  onChange={() => flip(action.key)}
                />
                <span>
                  <span className="block font-semibold">{action.label}</span>
                  <span className="block text-muted">{action.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {losesEngineers && (
            <p role="status" className="rounded-lg bg-warn-bg px-3.5 py-2.5 text-[13px] text-warn">
              People with this role will stop being engineers. Tickets already assigned to them stay
              assigned until a manager reassigns them.
            </p>
          )}
        </fieldset>

        {existing && (
          <section aria-labelledby="role-people" className="flex flex-col gap-1.5">
            <h3 id="role-people" className="text-[13px] font-semibold">
              People with this role
            </h3>
            {detail.error && <p className="text-[13px] text-bad">Couldn&apos;t load people.</p>}
            {!detail.data && !detail.error && <p className="text-[13px] text-muted">Loading…</p>}
            {detail.data && (
              <p className="text-[13px] text-muted">
                {detail.data.users.length
                  ? detail.data.users.map((u) => u.name).join(", ")
                  : "Nobody has this role yet. Give it to people under Users & roles."}
              </p>
            )}
          </section>
        )}
      </form>
    </Drawer>
  );
}
