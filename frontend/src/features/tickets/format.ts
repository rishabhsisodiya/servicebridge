import type { SlaStatus, TicketEvent } from "./api";
import type { TicketStage } from "./display";

const MINUTE = 60_000;

/** "45m", "2h 05m", "3d 4h" */
export function formatSpan(ms: number): string {
  const minutes = Math.max(0, Math.round(Math.abs(ms) / MINUTE));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** The SLA badge text: "22m left", "Breached 45m", "Paused", "Met". */
export function slaText(sla: SlaStatus, now = new Date()): string {
  const clock = sla.clock === "response" ? "Response" : "Resolution";
  switch (sla.state) {
    case "none":
      return "—";
    case "paused":
      return "Paused";
    case "met":
      return "Met";
    case "breach":
      return sla.metAt
        ? `Missed by ${formatSpan(new Date(sla.metAt).getTime() - new Date(sla.dueAt!).getTime())}`
        : `${clock} breached ${formatSpan(now.getTime() - new Date(sla.dueAt!).getTime())}`;
    default:
      return `${formatSpan(new Date(sla.dueAt!).getTime() - now.getTime())} left`;
  }
}

/** "Today 09:41", "Yesterday 17:05", "22 Sep 11:20" */
export function formatWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((day(now) - day(date)) / 86_400_000);
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

const ACTION_TEXT: Record<string, string> = {
  triage: "acknowledged the ticket",
  accept: "accepted the ticket",
  decline: "declined the ticket",
  arrive: "reached the site",
  start: "started work",
  hold: "put the ticket on hold",
  resume: "resumed work",
  resolve: "marked the ticket resolved",
  verify: "verified the fix",
  reject: "sent the ticket back for more work",
  close: "closed the ticket",
  cancel: "cancelled the ticket",
};

/** One timeline line: who did what, plus any detail. The actor's name is shown separately. */
export function describeEvent(
  event: TicketEvent,
  stageLabel: (stage: TicketStage) => string,
): { what: string; detail?: string } {
  const data = event.data ?? {};
  const clock = data.clock === "response" ? "response" : "resolution";
  switch (event.type) {
    case "CREATED":
      return { what: "logged the ticket" };
    case "ROUTED":
      return data.regionName
        ? { what: `routed the ticket to ${String(data.regionName)}` }
        : {
            what: "couldn't match the site to a region",
            detail: data.pincode ? `pincode ${String(data.pincode)}` : "no site pincode",
          };
    case "ASSIGNED":
      return {
        what: data.previousEngineerId
          ? `reassigned the ticket to ${String(data.engineerName)}`
          : `assigned ${String(data.engineerName)}`,
      };
    case "STAGE_CHANGED":
      return {
        what:
          ACTION_TEXT[String(data.action)] ??
          `moved the ticket to ${event.toStage ? stageLabel(event.toStage) : "a new stage"}`,
        detail:
          data.action === "resume" && data.pausedMinutes
            ? `paused ${formatSpan(Number(data.pausedMinutes) * MINUTE)}`
            : undefined,
      };
    case "NOTE":
      return { what: "added a note" };
    case "PRIORITY_CHANGED":
      return {
        what: `changed the priority from ${String(data.from).toLowerCase()} to ${String(data.to).toLowerCase()}`,
      };
    case "ATTACHMENT":
      return { what: `added ${String(data.fileName ?? "a file")}` };
    case "SLA_AT_RISK":
      return { what: `flagged the ${clock} time as at risk` };
    case "SLA_BREACHED":
      return { what: `recorded that the ${clock} time was missed` };
    case "REOPENED":
      return { what: "reopened the ticket" };
  }
}
