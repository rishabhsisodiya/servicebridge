"use client";

import useSWR from "swr";
import { getReadiness, type Readiness } from "@/lib/api/health";

const LABELS: Record<keyof Readiness["checks"], string> = {
  database: "Database",
  redis: "Queue store (Redis)",
};

/** Temporary foundations widget; replaced by the real shell in session 2. */
export function SystemStatus() {
  const { data, error, isLoading } = useSWR("health/ready", getReadiness, {
    refreshInterval: 0,
    shouldRetryOnError: false,
  });

  if (isLoading) {
    return <p role="status">Checking the API…</p>;
  }
  if (error || !data) {
    return (
      <p role="alert" className="text-red-700 dark:text-red-300">
        API unreachable. Start the backend and check API_INTERNAL_URL.
      </p>
    );
  }

  return (
    <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-2" aria-label="API status">
      {(Object.keys(LABELS) as (keyof Readiness["checks"])[]).map((key) => {
        const check = data.checks[key];
        const up = check.status === "up";
        return (
          <div key={key} className="contents">
            <dt>{LABELS[key]}</dt>
            <dd
              className={
                up ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"
              }
            >
              {up ? `Up · ${check.latencyMs} ms` : "Down"}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
