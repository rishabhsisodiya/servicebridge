"use client";

import { Wrench } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { StatusPill, type Tone } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Avatar } from "@/components/ui/misc";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";

export type DutyStatus = "ON_DUTY" | "OFF_DUTY" | "ON_LEAVE";

export const DUTY_LABEL: Record<DutyStatus, string> = {
  ON_DUTY: "On duty",
  OFF_DUTY: "Off duty",
  ON_LEAVE: "On leave",
};

export interface EngineerRow {
  id: string;
  name: string;
  region: string | null;
  dutyStatus: DutyStatus;
  onVisit: boolean;
  openTickets: number;
  skills: string[];
  canChange: boolean;
}

/** What people see: "On visit" (derived) wins over "On duty"; off duty and on leave always show. */
export function availability(duty: DutyStatus, onVisit: boolean): { label: string; tone: Tone } {
  if (duty === "ON_LEAVE") return { label: "On leave", tone: "done" };
  if (duty === "OFF_DUTY") return { label: "Off duty", tone: "done" };
  return onVisit ? { label: "On visit", tone: "prog" } : { label: "Available", tone: "ok" };
}

export function AvailabilityPill({ duty, onVisit }: { duty: DutyStatus; onVisit: boolean }) {
  const { label, tone } = availability(duty, onVisit);
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

const DUTY_OPTIONS = (Object.keys(DUTY_LABEL) as DutyStatus[]).map((value) => ({
  value,
  label: DUTY_LABEL[value],
}));

/** The engineer's own on/off duty switch. */
export function MyDutyControl({ value, onChanged }: { value: DutyStatus; onChanged: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const change = async (dutyStatus: DutyStatus) => {
    if (dutyStatus === value || saving) return;
    setSaving(true);
    try {
      await apiFetch("/engineers/me/duty", { method: "PATCH", json: { dutyStatus } });
      toast.success(
        dutyStatus === "ON_DUTY"
          ? "You're on duty. New tickets can be assigned to you."
          : `You're ${DUTY_LABEL[dutyStatus].toLowerCase()}. Managers won't be offered you first.`,
      );
      onChanged();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Segmented label="My availability" value={value} onChange={change} options={DUTY_OPTIONS} />
  );
}

export const ENGINEERS_KEY = "/engineers";

/** Managers' list of engineers with availability; duty can be changed where allowed. */
export function EngineersCard() {
  const toast = useToast();
  const { data, error, mutate } = useSWR<EngineerRow[]>(ENGINEERS_KEY, (k: string) =>
    apiFetch<EngineerRow[]>(k),
  );

  const setDuty = async (engineer: EngineerRow, dutyStatus: DutyStatus) => {
    try {
      await apiFetch(`/engineers/${engineer.id}/duty`, { method: "PATCH", json: { dutyStatus } });
      toast.success(`${engineer.name} is now ${DUTY_LABEL[dutyStatus].toLowerCase()}.`);
      await mutate();
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    }
  };

  const summary = data
    ? (() => {
        const visiting = data.filter((e) => e.dutyStatus === "ON_DUTY" && e.onVisit).length;
        const free = data.filter((e) => e.dutyStatus === "ON_DUTY" && !e.onVisit).length;
        return `${visiting} on visit · ${free} available`;
      })()
    : undefined;

  return (
    <Card aria-labelledby="engineers-title">
      <CardHeader titleId="engineers-title" title="Engineers" meta={summary} />
      {!data && !error && <TableSkeleton rows={4} label="Loading engineers" />}
      {error && !data && (
        <ErrorState title="Couldn't load engineers" onRetry={() => void mutate()} />
      )}
      {data?.length === 0 && (
        <EmptyState
          icon={<Wrench className="size-6" />}
          title="No engineers yet"
          description="Invite engineers under Settings → Users & roles."
        />
      )}
      {data && data.length > 0 && (
        <ul className="m-0 list-none p-0">
          {data.map((engineer) => (
            <li
              key={engineer.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2.5 last:border-b-0"
            >
              <Avatar name={engineer.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{engineer.name}</span>
                <span className="block truncate text-xs text-muted">
                  {[engineer.region, engineer.skills.join(", ")].filter(Boolean).join(" · ") ||
                    "No region or skills"}
                </span>
              </span>
              <AvailabilityPill duty={engineer.dutyStatus} onVisit={engineer.onVisit} />
              <span className="w-14 text-right text-xs text-muted">
                {engineer.openTickets} open
              </span>
              {engineer.canChange && (
                <Select
                  aria-label={`Availability of ${engineer.name}`}
                  value={engineer.dutyStatus}
                  onChange={(e) => void setDuty(engineer, e.target.value as DutyStatus)}
                  className="min-h-8 w-auto! py-1 text-[13px]"
                >
                  {DUTY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
