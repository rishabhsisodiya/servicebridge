"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Drawer } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, TableSkeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/auth/session";
import { apiFetch } from "@/lib/api/client";
import type { LabelRow } from "./api";
import { errorsFrom, FormAlert, type FormErrors } from "./shared";

interface LabelsTabProps<R extends LabelRow> {
  /** e.g. "/service-rules/priorities" */
  endpoint: string;
  keyOf: (row: R) => string;
  title: string;
  meta: string;
  noun: string;
}

/**
 * Renameable fixed values (priorities, ticket stages). The set itself is fixed
 * because SLA rules and the ticket workflow depend on it; only wording changes.
 */
export function LabelsTab<R extends LabelRow>({
  endpoint,
  keyOf,
  title,
  meta,
  noun,
}: LabelsTabProps<R>) {
  const canEdit = useSession().can("rules.edit");
  const rows = useSWR<R[]>(endpoint, (k: string) => apiFetch<R[]>(k));
  const [editing, setEditing] = useState<R | null>(null);

  if (rows.error)
    return <ErrorState title={`Couldn't load ${noun}s`} onRetry={() => void rows.mutate()} />;
  if (!rows.data) return <TableSkeleton label={`Loading ${noun}s`} />;

  return (
    <Card>
      <CardHeader title={title} meta={meta} />
      <Table caption={title}>
        <thead>
          <tr>
            <Th>Shown as</Th>
            <Th>Meaning</Th>
          </tr>
        </thead>
        <tbody>
          {rows.data.map((row) => (
            <Tr key={keyOf(row)}>
              <Td className="min-w-40">
                <button
                  type="button"
                  onClick={() => setEditing(row)}
                  className="cursor-pointer font-semibold text-text underline-offset-2 hover:underline"
                >
                  {row.label}
                </button>
              </Td>
              <Td className="min-w-64 text-muted">{row.description ?? "—"}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <LabelDrawer
        key={editing ? keyOf(editing) : "closed"}
        row={editing}
        systemName={editing ? keyOf(editing) : ""}
        path={editing ? `${endpoint}/${keyOf(editing)}` : ""}
        noun={noun}
        readOnly={!canEdit}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await rows.mutate();
        }}
      />
    </Card>
  );
}

function LabelDrawer({
  row,
  systemName,
  path,
  noun,
  onClose,
  onSaved,
  readOnly = false,
}: {
  row: LabelRow | null;
  systemName: string;
  path: string;
  noun: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  readOnly?: boolean;
}) {
  const toast = useToast();
  const [label, setLabel] = useState(row?.label ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const dirty = label !== (row?.label ?? "") || description !== (row?.description ?? "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!row) return;
    if (label.trim().length < 2) {
      setErrors({ label: "Enter a label." });
      return;
    }
    setSaving(true);
    try {
      await apiFetch(path, { method: "PATCH", json: { label, description, version: row.version } });
      toast.success(`${label.trim()} saved.`);
      await onSaved();
    } catch (caught) {
      setErrors(errorsFrom(caught, ["label", "description"]));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={!!row}
      onClose={onClose}
      dirty={dirty && !readOnly}
      title={`Rename ${noun}`}
      description="Everyone sees the new name straight away, on every ticket."
      footer={
        <>
          <Button onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
          {!readOnly && (
            <Button type="submit" form="label-form" variant="primary" loading={saving}>
              Save
            </Button>
          )}
        </>
      }
    >
      <form id="label-form" onSubmit={submit} noValidate>
        <fieldset disabled={readOnly} className="min-w-0 flex flex-col gap-4">
          <FormAlert message={errors.form} />
          <Field label="Shown as" required error={errors.label}>
            {(p) => (
              <Input
                {...p}
                value={label}
                maxLength={40}
                onChange={(e) => setLabel(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Meaning"
            error={errors.description}
            help="Helps people choose the right one."
          >
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                maxLength={200}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">System name</span>
            <span className="font-mono text-xs text-muted">{systemName}</span>
            <p className="text-xs text-muted">
              The name the system uses internally. It can&apos;t be changed.
            </p>
          </div>
        </fieldset>
      </form>
    </Drawer>
  );
}
