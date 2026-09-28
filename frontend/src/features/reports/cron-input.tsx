"use client";

import cronstrue from "cronstrue";
import { useState } from "react";
import { Field, Input, Select } from "@/components/ui/field";

const PRESETS = [
  { cron: "0 8 * * 1", label: "Weekly, Monday 08:00" },
  { cron: "0 8 * * *", label: "Daily, 08:00" },
  { cron: "0 8 1 * *", label: "Monthly, 1st at 08:00" },
  { cron: "30 2 * * *", label: "Daily, 02:30" },
];

export function describeCron(cron: string): string {
  try {
    return cronstrue.toString(cron, { use24HourTimeFormat: true, verbose: false });
  } catch {
    return cron;
  }
}

/** Schedule cadence picker: presets plus a custom cron expression, same UX as automations. */
export function CronInput({
  cron,
  onChange,
  timezone,
  onTimezoneChange,
  error,
}: {
  cron: string;
  onChange: (cron: string) => void;
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
  error?: string;
}) {
  const [mode, setMode] = useState(PRESETS.some((p) => p.cron === cron) ? cron : "custom");

  return (
    <div className="flex flex-col gap-4">
      <Field label="How often">
        {(p) => (
          <Select
            {...p}
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              if (e.target.value !== "custom") onChange(e.target.value);
              else requestAnimationFrame(() => document.getElementById("schedule-cron")?.focus());
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.cron} value={p.cron}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </Select>
        )}
      </Field>
      <Field
        label="Cron expression"
        error={error}
        help={cron ? `Runs: ${describeCron(cron)}` : "minute hour day-of-month month day-of-week"}
      >
        {(p) => (
          <Input
            {...p}
            id="schedule-cron"
            className="font-mono"
            value={cron}
            onChange={(e) => {
              onChange(e.target.value);
              if (!PRESETS.some((p) => p.cron === e.target.value)) setMode("custom");
            }}
            placeholder="0 8 * * 1"
          />
        )}
      </Field>
      <Field label="Timezone" help="Report times are interpreted in this timezone.">
        {(p) => (
          <Input
            {...p}
            value={timezone}
            onChange={(e) => onTimezoneChange(e.target.value)}
            placeholder="Asia/Kolkata"
          />
        )}
      </Field>
    </div>
  );
}
