"use client";

import { AlertTriangle, Clock, PauseCircle } from "lucide-react";
import { StatusPill, type Tone } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { type SlaStatus, useTicketLabels } from "./api";
import { slaText } from "./format";

/** Ticket lifecycle from the approved design. ON_HOLD and CANCELLED sit outside the main flow. */
export const TICKET_FLOW = [
  "NEW",
  "TRIAGED",
  "ASSIGNED",
  "ACCEPTED",
  "ON_SITE",
  "IN_PROGRESS",
  "RESOLVED",
  "VERIFIED",
  "CLOSED",
] as const;

export type TicketStage = (typeof TICKET_FLOW)[number] | "ON_HOLD" | "CANCELLED";

/** Colour per stage, and the default label shown until the admin's labels load. */
export const STAGE_DISPLAY: Record<TicketStage, { label: string; tone: Tone }> = {
  NEW: { label: "New", tone: "info" },
  TRIAGED: { label: "With area manager", tone: "info" },
  ASSIGNED: { label: "Engineer assigned", tone: "info" },
  ACCEPTED: { label: "Accepted", tone: "info" },
  ON_SITE: { label: "On site", tone: "prog" },
  IN_PROGRESS: { label: "In progress", tone: "prog" },
  ON_HOLD: { label: "On hold", tone: "warn" },
  RESOLVED: { label: "Resolved", tone: "ok" },
  VERIFIED: { label: "Verified", tone: "ok" },
  CLOSED: { label: "Closed", tone: "done" },
  CANCELLED: { label: "Cancelled", tone: "done" },
};

/** Stage badge using the admin's wording (Settings → Service rules → Stage labels). */
export function StagePill({ stage }: { stage: TicketStage }) {
  const labels = useTicketLabels();
  return <StatusPill tone={STAGE_DISPLAY[stage].tone}>{labels.stage(stage)}</StatusPill>;
}

export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export const PRIORITY_ORDER: Priority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const PRIORITY: Record<Priority, { bars: number; color: string }> = {
  CRITICAL: { bars: 4, color: "text-bad" },
  HIGH: { bars: 3, color: "text-prog" },
  MEDIUM: { bars: 2, color: "text-text" },
  LOW: { bars: 1, color: "text-muted" },
};

/** Signal-strength bars plus the word, so priority reads without colour. */
export function PriorityMark({ priority }: { priority: Priority }) {
  const { bars, color } = PRIORITY[priority];
  const label = useTicketLabels().priority(priority);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap",
        color,
      )}
    >
      <span aria-hidden className="inline-flex items-end gap-[2px]">
        {[6, 9, 12, 15].map((height, i) => (
          <span
            key={height}
            className={cn("w-[3px] rounded-[1px]", i < bars ? "bg-current" : "bg-line-strong")}
            style={{ height }}
          />
        ))}
      </span>
      {label}
    </span>
  );
}

const SLA_COLOR: Record<SlaStatus["state"], string> = {
  ok: "text-ok",
  met: "text-ok",
  risk: "text-prog",
  breach: "text-bad",
  paused: "text-muted",
  none: "text-muted",
};

/** SLA badge: icon + text, so the state reads without colour. */
export function SlaMark({ sla, now }: { sla: SlaStatus; now?: Date }) {
  const Icon =
    sla.state === "breach" ? AlertTriangle : sla.state === "paused" ? PauseCircle : Clock;
  const kind = sla.clock === "response" ? "Response" : "Resolution";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[13px] font-semibold whitespace-nowrap",
        SLA_COLOR[sla.state],
      )}
      title={`${kind} SLA`}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{kind} SLA: </span>
      {slaText(sla, now)}
    </span>
  );
}
