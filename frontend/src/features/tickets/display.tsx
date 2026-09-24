import { AlertTriangle, Clock, PauseCircle } from "lucide-react";
import { StatusPill, type Tone } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

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

/** Default labels; admins can rename them in Settings → Stage labels (session 7). */
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

export function StagePill({ stage }: { stage: TicketStage }) {
  const { label, tone } = STAGE_DISPLAY[stage];
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

const PRIORITY: Record<Priority, { label: string; bars: number; color: string }> = {
  CRITICAL: { label: "Critical", bars: 4, color: "text-bad" },
  HIGH: { label: "High", bars: 3, color: "text-prog" },
  MEDIUM: { label: "Medium", bars: 2, color: "text-text" },
  LOW: { label: "Low", bars: 1, color: "text-muted" },
};

/** Signal-strength bars plus the word, so priority reads without colour. */
export function PriorityMark({ priority }: { priority: Priority }) {
  const { label, bars, color } = PRIORITY[priority];
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

export type SlaState = "ok" | "risk" | "breach" | "paused" | "met";

const SLA: Record<SlaState, string> = {
  ok: "text-ok",
  met: "text-ok",
  risk: "text-prog",
  breach: "text-bad",
  paused: "text-muted",
};

export function SlaMark({
  state,
  text,
  kind,
}: {
  state: SlaState;
  text: string;
  kind: "Response" | "Resolution";
}) {
  const Icon = state === "breach" ? AlertTriangle : state === "paused" ? PauseCircle : Clock;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[13px] font-semibold whitespace-nowrap",
        SLA[state],
      )}
      title={`${kind} SLA`}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{kind} SLA: </span>
      {text}
    </span>
  );
}
