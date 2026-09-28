"use client";

import { Lock, Pencil, Gauge } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/badge";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { defaultRange, reportsApi, type KpiMatrix, type KpiTargets, type KpiValue } from "./api";

function formatValue(kpi: KpiValue): string {
  if (kpi.value === null) return "—";
  const rounded = Math.round(kpi.value * 10) / 10;
  return `${rounded}${kpi.unit ? ` ${kpi.unit}` : ""}`;
}

function TargetCell({ kpi }: { kpi: KpiValue }) {
  if (kpi.target === null) return <span className="text-muted">—</span>;
  const state =
    kpi.met === null ? null : kpi.met ? (
      <StatusPill tone="ok">On target</StatusPill>
    ) : (
      <StatusPill tone="bad">Off target</StatusPill>
    );
  return (
    <span className="inline-flex items-center gap-2">
      <span>
        {kpi.target}
        {kpi.unit ? ` ${kpi.unit}` : ""}
      </span>
      {state}
    </span>
  );
}

/** Edits the global targets (per-region overrides stay as they are). */
function TargetsDialog({
  targets,
  onClose,
  onSaved,
}: {
  targets: KpiTargets;
  onClose: () => void;
  onSaved: (t: KpiTargets) => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, String(v.target)])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const labels: Record<string, string> = {
    "sla-compliance": "SLA compliance (%)",
    "avg-resolution-hours": "Avg resolution time (hrs)",
    "reopen-rate": "Reopen rate (%)",
    "csat-average": "CSAT average (/5)",
    "backlog-change": "Backlog change",
    "visit-completion": "Visit completion (%)",
  };

  const submit = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const next: KpiTargets = {};
      for (const [key, raw] of Object.entries(values)) {
        const target = Number(raw);
        if (!Number.isFinite(target) || target < 0) throw new Error(`"${labels[key]}" must be a non-negative number.`);
        next[key] = { target, regions: targets[key]?.regions ?? {} };
      }
      const saved = await reportsApi.updateKpiTargets(next);
      toast.success("KPI targets updated.");
      onSaved(saved);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : (caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="KPI targets"
      description="Targets apply to every region unless a region has its own override."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="strong" onClick={submit} loading={saving}>
            Save targets
          </Button>
        </>
      }
    >
      {Object.keys(labels).map((key) => (
        <Field key={key} label={labels[key]}>
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              value={values[key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
            />
          )}
        </Field>
      ))}
      {error && <p className="text-sm text-bad">{error}</p>}
    </Dialog>
  );
}

export function KpiMatrixScreen() {
  const { can, me } = useSession();
  const [range] = useState(defaultRange);
  const [editing, setEditing] = useState(false);
  const allowed = can("reports.read");
  const canSchedule = can("reports.schedule");

  const {
    data: matrix,
    error: matrixError,
    isLoading: matrixLoading,
  } = useSWR<KpiMatrix, ApiError>(
    allowed ? `/reports/kpi?from=${range.from}&to=${range.to}` : null,
    (key: string) => apiFetch<KpiMatrix>(key),
  );
  const { data: targets, mutate: mutateTargets } = useSWR<KpiTargets, ApiError>(
    canSchedule ? "/reports/kpi/targets" : null,
    (key: string) => apiFetch<KpiTargets>(key),
  );

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="KPI matrix" />
        <Card>
          <EmptyState
            icon={<Lock className="size-6" />}
            title="You don't have access to this"
            description="Ask your administrator for access to reports."
          />
        </Card>
      </>
    );
  }

  const kpiKeys = matrix?.rows[0]?.kpis ?? [];

  return (
    <>
      <PageHeader
        title="KPI matrix"
        description={
          matrix
            ? `Service KPIs against targets, by region · ${matrix.from} to ${matrix.to}`
            : "Service KPIs against targets, by region."
        }
        actions={
          canSchedule && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden /> Edit targets
            </Button>
          )
        }
      />
      {matrixLoading && <TableSkeleton />}
      {matrixError && <ErrorState title="KPIs could not load" description={matrixError.message} />}
      {matrix && matrix.rows.length === 0 && (
        <Card>
          <EmptyState icon={<Gauge className="size-6" />} title="No regions" description="There are no regions to report on yet." />
        </Card>
      )}
      {matrix && matrix.rows.length > 0 && (
        <Card>
          <CardHeader title="By region" meta={`${matrix.rows.length} rows`} />
          <div className="relative overflow-x-auto">
            <Table>
              <thead>
                <Tr>
                  <Th>Region</Th>
                  {kpiKeys.map((k) => (
                    <Th key={k.key}>{k.label}</Th>
                  ))}
                </Tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <Tr key={row.regionId ?? "all"}>
                    <Td>
                      <span className="font-semibold">{row.regionName}</span>
                    </Td>
                    {row.kpis.map((kpi) => (
                      <Td key={kpi.key}>
                        <div className="flex flex-col gap-1">
                          <span className="text-[15px] font-semibold">{formatValue(kpi)}</span>
                          <span className="text-xs text-muted">
                            Target <TargetCell kpi={kpi} />
                          </span>
                        </div>
                      </Td>
                    ))}
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
      {editing && targets && (
        <TargetsDialog
          targets={targets}
          onClose={() => setEditing(false)}
          onSaved={(t) => mutateTargets(t, { revalidate: false })}
        />
      )}
    </>
  );
}
