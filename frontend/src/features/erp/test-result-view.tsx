import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Database,
  Globe,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { type ErpPurpose, PURPOSE_DOCTYPES, type TestResult } from "./api";

const PURPOSE_NAMES: Record<ErpPurpose, string> = {
  MASTER_SYNC: "Master data sync",
  WRITEBACK: "Write-backs",
};

function Line({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  const Icon = ok === null ? CircleHelp : ok ? CheckCircle2 : XCircle;
  return (
    <li className="flex items-start gap-2">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          ok === null ? "text-muted" : ok ? "text-ok" : "text-bad",
        )}
        aria-hidden
      />
      <span className="sr-only">{ok === null ? "Not checked: " : ok ? "OK: " : "Problem: "}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="flex items-center gap-1.5 text-[13px] font-semibold">
        {icon}
        {title}
      </h4>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">{children}</ul>
    </div>
  );
}

/** Plain-language summary of a connection test. */
export function TestResultView({ result }: { result: TestResult }) {
  const access = new Map(result.access.map((a) => [a.doctype, a.canRead]));
  const versions = result.rest.versions;

  return (
    <div className="flex flex-col gap-4" aria-label="Connection test result">
      <p
        role="status"
        className={cn(
          "flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[13px] font-semibold",
          result.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad",
        )}
      >
        {result.ok ? (
          <CheckCircle2 className="size-4" aria-hidden />
        ) : (
          <AlertTriangle className="size-4" aria-hidden />
        )}
        {result.ok ? "Connection works" : "Connection test failed"}
        <span className="ml-auto font-normal text-muted">
          {new Date(result.testedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
      </p>

      <Section icon={<Globe className="size-4 text-muted" aria-hidden />} title="ERPNext API">
        {result.rest.ok ? (
          <>
            <Line ok>
              Signed in as <span className="font-semibold">{result.rest.user}</span>
            </Line>
            {versions && (
              <Line ok>
                {Object.entries(versions)
                  .map(
                    ([app, version]) =>
                      `${app === "erpnext" ? "ERPNext" : app === "frappe" ? "Frappe" : app} ${version}`,
                  )
                  .join(" · ")}
              </Line>
            )}
          </>
        ) : (
          <Line ok={false}>{result.rest.error?.message}</Line>
        )}
      </Section>

      {result.rest.ok && (
        <Section
          icon={<CheckCircle2 className="size-4 text-muted" aria-hidden />}
          title="What this connection can be used for"
        >
          {(Object.keys(PURPOSE_DOCTYPES) as ErpPurpose[]).map((purpose) => {
            const blocked = PURPOSE_DOCTYPES[purpose].filter(
              (doctype) => access.get(doctype) !== true,
            );
            return (
              <Line key={purpose} ok={blocked.length === 0}>
                <span className="font-semibold">{PURPOSE_NAMES[purpose]}</span>
                {blocked.length > 0 && (
                  <span className="block text-muted">
                    The API user can&apos;t read: {blocked.join(", ")}. Give its role read access in
                    ERPNext, then test again.
                  </span>
                )}
              </Line>
            );
          })}
        </Section>
      )}

      {result.db && (
        <Section
          icon={<Database className="size-4 text-muted" aria-hidden />}
          title="Database (read-only)"
        >
          {result.db.error && !result.db.tables ? (
            <Line ok={false}>{result.db.error.message}</Line>
          ) : (
            <>
              <Line ok={result.db.ok}>
                {result.db.ok
                  ? `Connected · ${result.db.serverVersion ?? "MariaDB"}`
                  : result.db.error?.message}
              </Line>
              {result.db.grants === "SELECT_ONLY" && (
                <Line ok>The database user can only read.</Line>
              )}
              {result.db.grants === "HAS_WRITE_GRANTS" && (
                <li className="flex items-start gap-2 rounded-lg bg-warn-bg px-3 py-2 text-warn">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="text-text">
                    This database user can also: {result.db.extraPrivileges?.join(", ")}.
                    ERPTick never writes to the database, but a user with only SELECT access
                    is safer. Ask your ERP administrator for one.
                  </span>
                </li>
              )}
              {result.db.grants === "UNVERIFIED" && (
                <Line ok={null}>
                  Couldn&apos;t confirm the user is read-only (its access comes from a role).
                </Line>
              )}
            </>
          )}
        </Section>
      )}

      {result.rest.ok && (
        <Section
          icon={<CircleHelp className="size-4 text-muted" aria-hidden />}
          title="Setup for write-backs (later)"
        >
          {result.setup.missingFields === null ? (
            <Line ok={null}>
              Couldn&apos;t check custom fields (the API user can&apos;t read Custom Field).
            </Line>
          ) : result.setup.missingFields.length === 0 ? (
            <Line ok>ERPTick&apos;s reference field is set up.</Line>
          ) : (
            <Line ok={null}>
              Not needed yet. Before switching on write-backs, add a Data field named{" "}
              <code className="font-mono text-xs">custom_sb_ref</code> to{" "}
              {result.setup.missingFields.map((f) => f.doctype).join(" and ")}.
            </Line>
          )}
        </Section>
      )}
    </div>
  );
}
