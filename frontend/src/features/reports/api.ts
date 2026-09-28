import { apiFetch, ApiError, API_BASE } from "@/lib/api/client";

export interface ReportParamOption {
  value: string;
  label: string;
}

export interface ReportParamDef {
  key: string;
  label: string;
  type: "date" | "select";
  required?: boolean;
  options?: ReportParamOption[];
}

export interface ReportCatalogEntry {
  key: string;
  label: string;
  description: string;
  params: ReportParamDef[];
}

export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportPreview {
  reportKey: string;
  label: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  total: number;
  truncated: boolean;
  summary: Record<string, string | number>;
}

export type KpiKey =
  | "sla-compliance"
  | "avg-resolution-hours"
  | "reopen-rate"
  | "csat-average"
  | "backlog-change"
  | "visit-completion";

export interface KpiValue {
  key: KpiKey;
  label: string;
  value: number | null;
  target: number | null;
  unit: string;
  better: "higher" | "lower";
  met: boolean | null;
}

export interface KpiRegionRow {
  regionId: string | null;
  regionName: string;
  kpis: KpiValue[];
}

export interface KpiMatrix {
  from: string;
  to: string;
  rows: KpiRegionRow[];
}

export type KpiTargets = Record<string, { target: number; regions?: Record<string, number> }>;

export interface ReportSchedule {
  id: string;
  name: string;
  reportKey: string;
  params: Record<string, string>;
  cron: string;
  timezone: string;
  recipients: string[];
  active: boolean;
  lastRunAt: string | null;
  createdBy: { id: string; name: string } | null;
  version: number;
  createdAt: string;
}

export interface ReportRun {
  id: string;
  reportKey: string;
  trigger: "MANUAL" | "SCHEDULE";
  status: "RUNNING" | "SUCCESS" | "FAILED";
  rowCount: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  csvKey: string | null;
  requestedBy: { id: string; name: string } | null;
}

export interface ActiveUser {
  id: string;
  name: string;
  email: string;
}

/** Downloads a CSV that the API streams; throws ApiError on failure. */
async function downloadBlob(path: string, init: RequestInit, filename: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: "same-origin", ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = body?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "BAD_RESPONSE",
      error?.message ?? "The download failed.",
      error?.fields ?? [],
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const reportsApi = {
  catalog: () => apiFetch<ReportCatalogEntry[]>("/reports"),
  preview: (key: string, params: Record<string, string>) =>
    apiFetch<ReportPreview>(`/reports/${key}/run?format=json`, {
      method: "POST",
      json: { params },
    }),
  download: (key: string, params: Record<string, string>) =>
    downloadBlob(`/reports/${key}/run?format=csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params }),
    }, `${key}.csv`),

  kpiMatrix: (from: string, to: string) =>
    apiFetch<KpiMatrix>(`/reports/kpi?from=${from}&to=${to}`),
  kpiTargets: () => apiFetch<KpiTargets>("/reports/kpi/targets"),
  updateKpiTargets: (targets: KpiTargets) =>
    apiFetch<KpiTargets>("/reports/kpi/targets", { method: "PATCH", json: targets }),

  schedules: () => apiFetch<ReportSchedule[]>("/report-schedules"),
  createSchedule: (body: {
    name: string;
    reportKey: string;
    params: Record<string, string>;
    cron: string;
    timezone: string;
    recipients: string[];
  }) => apiFetch<ReportSchedule>("/report-schedules", { method: "POST", json: body }),
  updateSchedule: (id: string, body: Record<string, unknown>) =>
    apiFetch<ReportSchedule>(`/report-schedules/${id}`, { method: "PATCH", json: body }),
  deleteSchedule: (id: string) =>
    apiFetch<void>(`/report-schedules/${id}`, { method: "DELETE" }),
  activate: (id: string) =>
    apiFetch<{ ok: boolean }>(`/report-schedules/${id}/activate`, { method: "POST" }),
  deactivate: (id: string) =>
    apiFetch<{ ok: boolean }>(`/report-schedules/${id}/deactivate`, { method: "POST" }),
  runs: (id: string) => apiFetch<ReportRun[]>(`/report-schedules/${id}/runs`),
  downloadRun: (runId: string) =>
    downloadBlob(`/report-runs/${runId}/download`, {}, `report-${runId}.csv`),

  /** Active users with an email address, for the recipient picker. */
  activeUsers: () =>
    apiFetch<{ data: ActiveUser[] }>("/users?status=ACTIVE&pageSize=100").then((p) => p.data),
};

export function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}
