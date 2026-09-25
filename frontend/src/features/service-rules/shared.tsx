"use client";

import { Input, Select } from "@/components/ui/field";
import { ApiError } from "@/lib/api/client";
import type { FieldControlProps } from "@/components/ui/field";

export type FormErrors = Record<string, string | undefined>;

/** Maps an API failure to field messages; anything else becomes the form-level message. */
export function errorsFrom(caught: unknown, fields: readonly string[]): FormErrors {
  const apiError = caught instanceof ApiError ? caught : undefined;
  const errors: FormErrors = {};
  for (const field of fields) {
    const message = apiError?.fieldMessage(field);
    if (message) errors[field] = message;
  }
  if (!Object.keys(errors).length) {
    errors.form = apiError?.message ?? "Something went wrong. Try again.";
  }
  return errors;
}

export function FormAlert({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-bad-bg px-3.5 py-2.5 text-[13px] text-bad">
      {message}
    </p>
  );
}

/** "45 min", "4 h", "2 d 6 h" */
export function formatMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  return [days && `${days} d`, hours && `${hours} h`, minutes && `${minutes} min`]
    .filter(Boolean)
    .join(" ");
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
/** Monday first, the way people read a work week. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function formatDue(iso: string, timeZone: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

type Unit = "min" | "h" | "d";
const UNIT_MINUTES: Record<Unit, number> = { min: 1, h: 60, d: 1440 };

/** The largest unit that divides the value exactly. */
export function splitMinutes(total: number): { value: string; unit: Unit } {
  if (total > 0 && total % 1440 === 0) return { value: String(total / 1440), unit: "d" };
  if (total > 0 && total % 60 === 0) return { value: String(total / 60), unit: "h" };
  return { value: String(total), unit: "min" };
}

export function joinMinutes(value: string, unit: Unit): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * UNIT_MINUTES[unit]) : NaN;
}

/** Number + unit picker for SLA targets. */
export function DurationInput({
  control,
  value,
  unit,
  onChange,
}: {
  control: FieldControlProps;
  value: string;
  unit: Unit;
  onChange: (next: { value: string; unit: Unit }) => void;
}) {
  return (
    <div className="flex gap-2">
      <Input
        {...control}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={value}
        onChange={(e) => onChange({ value: e.target.value, unit })}
        className="min-w-0 flex-1"
      />
      <Select
        aria-label="Unit"
        value={unit}
        onChange={(e) => onChange({ value, unit: e.target.value as Unit })}
        className="w-28!"
      >
        <option value="min">minutes</option>
        <option value="h">hours</option>
        <option value="d">days</option>
      </Select>
    </div>
  );
}
