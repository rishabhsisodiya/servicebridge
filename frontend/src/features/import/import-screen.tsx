"use client";

import { CheckCircle2, Download, FileUp, TriangleAlert, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { StatusPill, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession, type Permission } from "@/lib/auth/session";
import { useStepUp } from "@/features/auth/use-step-up";

/* ── Types (mirror the backend imports API) ───────────────────────────────── */

export type ImportEntity = "customers" | "equipment";
export type RowMode = "create" | "update-fill" | "update-overwrite" | "skip";

export interface PreviewRow {
  index: number;
  data: Record<string, string>;
  status: "valid" | "warning" | "error";
  errors: string[];
  note: string | null;
  defaultMode: RowMode;
  matchedExisting: { id: string; name: string } | null;
}

export interface ValidationPreview {
  validationId: string;
  entity: ImportEntity;
  columns: string[];
  rows: PreviewRow[];
  summary: { valid: number; warning: number; error: number };
  expiresAt: string;
}

export interface ImportReport {
  created: number;
  updated: number;
  skipped: number;
  errors: { index: number; message: string }[];
}

const IMPORTS_EDIT: Permission = "imports.edit";

const ENTITY_META: Record<
  ImportEntity,
  { label: string; template: string[]; hint: string }
> = {
  customers: {
    label: "Customers",
    template: ["name", "customer_group", "territory", "tax_id", "mobile", "email"],
    hint: "name is required. Existing customers are matched by name (tax_id breaks ties); matched rows fill in blanks only.",
  },
  equipment: {
    label: "Machines",
    template: ["serial_no", "item_code", "item_name", "customer_name", "warranty_expires_on", "amc_expires_on"],
    hint: "serial_no is required. customer_name must already exist — import customers first. Dates are YYYY-MM-DD.",
  },
};

export const ROW_STATUS: Record<PreviewRow["status"], { label: string; tone: Tone }> = {
  valid: { label: "Ready", tone: "ok" },
  warning: { label: "Matched", tone: "warn" },
  error: { label: "Error", tone: "bad" },
};

export const ROW_MODE_LABELS: Record<RowMode, string> = {
  create: "Create",
  "update-fill": "Update (fill blanks)",
  "update-overwrite": "Update (overwrite)",
  skip: "Skip",
};

/** Builds a starter CSV template for the entity. Pure — unit tested. */
export function buildTemplate(entity: ImportEntity): string {
  return ENTITY_META[entity].template.join(",") + "\n";
}

export function downloadTemplate(entity: ImportEntity) {
  const blob = new Blob([buildTemplate(entity)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${entity}-template.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportScreen() {
  const { can } = useSession();
  const toast = useToast();
  const stepUp = useStepUp();
  const canImport = can(IMPORTS_EDIT);
  const fileRef = useRef<HTMLInputElement>(null);

  const [entity, setEntity] = useState<ImportEntity>("customers");
  const [preview, setPreview] = useState<ValidationPreview | null>(null);
  const [overrides, setOverrides] = useState<Record<number, RowMode>>({});
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const meta = ENTITY_META[entity];
  const visibleColumns = (preview?.columns ?? meta.template).filter((c) => !c.startsWith("_"));

  function pickFile() {
    setReport(null);
    fileRef.current?.click();
  }

  async function validateFile(file: File) {
    setBusy(true);
    setPreview(null);
    setOverrides({});
    setReport(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await apiFetch<ValidationPreview>(`/imports/${entity}/validate`, {
        method: "POST",
        form,
      });
      setPreview(result);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not read the file.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    try {
      const rows = Object.entries(overrides).map(([index, mode]) => ({
        index: Number(index),
        mode,
      }));
      const result = await stepUp.run(() =>
        apiFetch<ImportReport>(`/imports/${preview.entity}/confirm`, {
          method: "POST",
          json: { validationId: preview.validationId, rows },
        }),
      );
      setReport(result);
      setPreview(null);
      setOverrides({});
      toast.success(
        `Imported: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`,
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bulk import"
        description="Load customers or machines from a CSV file. Nothing is written until you review the preview and confirm."
      />

      {report && (
        <Card>
          <CardHeader title="Import report" />
          <CardBody>
            <div className="flex flex-wrap gap-6 text-sm">
              <span>
                <CheckCircle2 className="mr-1 inline size-4 text-ok" aria-hidden />
                {report.created} created
              </span>
              <span>
                <CheckCircle2 className="mr-1 inline size-4 text-info" aria-hidden />
                {report.updated} updated
              </span>
              <span className="text-muted">{report.skipped} skipped</span>
            </div>
            {report.errors.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 text-sm text-bad">
                {report.errors.map((e) => (
                  <li key={e.index}>
                    Row {e.index}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="1 · Choose a file"
          actions={
            <Button variant="ghost" size="sm" onClick={() => downloadTemplate(entity)}>
              <Download className="size-4" aria-hidden /> CSV template
            </Button>
          }
        />
        <CardBody>
          <div className="flex flex-col gap-4">
            <Segmented
              label="What to import"
              value={entity}
              onChange={(v) => {
                setEntity(v);
                setPreview(null);
                setOverrides({});
                setReport(null);
              }}
              options={[
                { value: "customers", label: "Customers" },
                { value: "equipment", label: "Machines" },
              ]}
            />
            <p className="text-sm text-muted">{meta.hint}</p>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                aria-label="CSV file to import"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void validateFile(file);
                }}
              />
              <Button onClick={pickFile} disabled={busy || !canImport}>
                <FileUp className="size-4" aria-hidden />
                {busy ? "Reading…" : "Choose CSV file"}
              </Button>
              {!canImport && (
                <p className="mt-2 text-sm text-muted">You need the bulk-import permission to load files.</p>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {preview && (
        <Card>
          <CardHeader
            title={`2 · Review — ${preview.summary.valid + preview.summary.warning} of ${preview.rows.length} rows ready`}
            actions={
              <Button disabled={busy} onClick={() => void confirm()}>
                Confirm import
              </Button>
            }
          />
          <CardBody>
            <p className="mb-3 text-xs text-muted">
              Preview expires {new Date(preview.expiresAt).toLocaleString()}. Error rows are
              skipped automatically; change the action per row if needed.
            </p>
            <div className="relative overflow-x-auto">
              <Table>
                <thead>
                  <Tr>
                    <Th>Row</Th>
                    <Th>Status</Th>
                    {visibleColumns.map((c) => (
                      <Th key={c}>{c}</Th>
                    ))}
                    <Th>Action</Th>
                  </Tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => {
                    const status = ROW_STATUS[row.status];
                    const mode = overrides[row.index] ?? row.defaultMode;
                    return (
                      <Tr key={row.index}>
                        <Td>{row.index}</Td>
                        <Td>
                          <StatusPill tone={status.tone}>{status.label}</StatusPill>
                          {row.errors.length > 0 && (
                            <ul className="mt-1 text-xs text-bad">
                              {row.errors.map((e, i) => (
                                <li key={i} className="flex items-start gap-1">
                                  <XCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
                                  {e}
                                </li>
                              ))}
                            </ul>
                          )}
                          {row.note && (
                            <p className="mt-1 flex items-start gap-1 text-xs text-muted">
                              <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                              {row.note}
                            </p>
                          )}
                        </Td>
                        {visibleColumns.map((c) => (
                          <Td key={c}>{row.data[c] || <span className="text-muted">—</span>}</Td>
                        ))}
                        <Td>
                          <Select
                            aria-label={`Action for row ${row.index}`}
                            value={mode}
                            disabled={row.status === "error" || busy}
                            onChange={(e) =>
                              setOverrides((prev) => ({
                                ...prev,
                                [row.index]: e.target.value as RowMode,
                              }))
                            }
                            className="sm:w-auto!"
                          >
                            {(Object.keys(ROW_MODE_LABELS) as RowMode[]).map((m) => (
                              <option key={m} value={m}>
                                {ROW_MODE_LABELS[m]}
                              </option>
                            ))}
                          </Select>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
            <Field label="Or pick another file" help="Validating a new file discards this preview.">
              {(control) => (
                <Input
                  {...control}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void validateFile(file);
                  }}
                />
              )}
            </Field>
          </CardBody>
        </Card>
      )}

      {!preview && !report && (
        <EmptyState
          icon={<FileUp className="size-6" aria-hidden />}
          title="No file yet"
          description="Choose a CSV file to see a row-by-row preview before anything is written."
        />
      )}
      {stepUp.dialog}
    </div>
  );
}
