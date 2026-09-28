"use client";

import { Download, Lock, Play } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { defaultRange, reportsApi, type ReportCatalogEntry, type ReportPreview } from "./api";

function cellText(value: string | number | null): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

/** Run a report: parameters, on-screen preview, CSV download. */
function RunDialog({ report, onClose }: { report: ReportCatalogEntry; onClose: () => void }) {
  const toast = useToast();
  const range = defaultRange();
  const [params, setParams] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const p of report.params) {
      if (p.type === "date") initial[p.key] = p.key === "from" ? range.from : range.to;
    }
    return initial;
  });
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [working, setWorking] = useState<"preview" | "download" | null>(null);
  const [error, setError] = useState<string>();

  const setParam = (key: string, value: string) =>
    setParams((prev) => ({ ...prev, [key]: value }));

  const run = async (mode: "preview" | "download") => {
    setWorking(mode);
    setError(undefined);
    try {
      if (mode === "preview") {
        setPreview(await reportsApi.preview(report.key, params));
      } else {
        await reportsApi.download(report.key, params);
        toast.success("The CSV download started.");
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The report could not run.");
    } finally {
      setWorking(null);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={report.label}
      description={report.description}
      className="w-[min(880px,calc(100vw-32px))]"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="strong" onClick={() => run("preview")} loading={working === "preview"}>
            <Play className="size-4" aria-hidden /> Preview
          </Button>
          <Button onClick={() => run("download")} loading={working === "download"}>
            <Download className="size-4" aria-hidden /> Download CSV
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {report.params.map((param) =>
          param.type === "date" ? (
            <Field key={param.key} label={param.label}>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={params[param.key] ?? ""}
                  onChange={(e) => setParam(param.key, e.target.value)}
                />
              )}
            </Field>
          ) : (
            <Field key={param.key} label={param.label}>
              {(p) => (
                <Select {...p} value={params[param.key] ?? ""} onChange={(e) => setParam(param.key, e.target.value)}>
                  <option value="">All</option>
                  {(param.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ),
        )}
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      {preview && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">
            {preview.total.toLocaleString("en-IN")} rows{preview.truncated ? " (capped at 10,000)" : ""} ·{" "}
            {Object.entries(preview.summary)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")}
          </p>
          <div className="relative overflow-x-auto">
            <Table>
              <thead>
                <Tr>
                  {preview.columns.map((c) => (
                    <Th key={c.key}>{c.label}</Th>
                  ))}
                </Tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <Tr key={i}>
                    {preview.columns.map((c) => (
                      <Td key={c.key}>{cellText(row[c.key])}</Td>
                    ))}
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          {preview.rows.length === 0 && <EmptyState icon={<Play className="size-6" />} title="No rows" description="Nothing matched these parameters." />}
        </div>
      )}
    </Dialog>
  );
}

export function ReportsBrowser() {
  const { can, me } = useSession();
  const [running, setRunning] = useState<ReportCatalogEntry | null>(null);
  const allowed = can("reports.read");

  const { data, error, isLoading } = useSWR<ReportCatalogEntry[], ApiError>(
    allowed ? "/reports" : null,
    (key: string) => apiFetch<ReportCatalogEntry[]>(key),
  );

  if (me && !allowed) {
    return (
      <>
        <PageHeader title="Reports" />
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

  return (
    <>
      <PageHeader
        title="Reports"
        description="Run a report on demand, preview it on screen, or download the CSV."
      />
      {isLoading && <TableSkeleton />}
      {error && <ErrorState title="Reports could not load" description={error.message} />}
      {data && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((report) => (
            <Card key={report.key}>
              <CardHeader
                title={report.label}
                meta="Service report"
                actions={
                  <Button variant="strong" size="sm" onClick={() => setRunning(report)}>
                    <Play className="size-4" aria-hidden /> Run
                  </Button>
                }
              />
              <p className="px-5 pb-5 text-sm text-muted">{report.description}</p>
            </Card>
          ))}
        </div>
      )}
      {running && <RunDialog report={running} onClose={() => setRunning(null)} />}
    </>
  );
}
