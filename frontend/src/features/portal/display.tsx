import { StatusPill, type Tone } from "@/components/ui/badge";
import { STAGE_DISPLAY, type TicketStage } from "@/features/tickets/display";

/** Stage badge with the shared tone mapping; unknown stages fall back to neutral. */
export function PortalStagePill({ stage }: { stage: string }) {
  const display = (STAGE_DISPLAY as Record<string, { label: string; tone: Tone }>)[stage];
  return (
    <StatusPill tone={display?.tone ?? "neutral"}>{display?.label ?? stage}</StatusPill>
  );
}

const PRIORITY_TONE: Record<string, Tone> = {
  CRITICAL: "bad",
  HIGH: "warn",
  MEDIUM: "info",
  LOW: "neutral",
};

export function PortalPriorityPill({ priority }: { priority: string }) {
  const tone = PRIORITY_TONE[priority.toUpperCase()] ?? "neutral";
  const label =
    priority.length > 0 ? priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase() : priority;
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

const AMC_STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "ok",
  EXPIRED: "done",
  CANCELLED: "neutral",
  DRAFT: "neutral",
};

export function PortalAmcStatusPill({ status }: { status: string }) {
  const tone = AMC_STATUS_TONE[status.toUpperCase()] ?? "info";
  const label =
    status.length > 0 ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : status;
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

/** Re-exported so portal components share the staff stage enum typing where needed. */
export type { TicketStage };
