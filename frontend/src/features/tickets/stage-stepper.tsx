import { cn } from "@/lib/cn";
import { STAGE_DISPLAY, TICKET_FLOW, type TicketStage } from "./display";

interface StageStepperProps {
  stage: TicketStage;
  /** Time each reached stage was entered, keyed by stage. */
  times?: Partial<Record<TicketStage, string>>;
}

/** Progress through the main flow. On hold keeps the last reached stage highlighted. */
export function StageStepper({ stage, times = {} }: StageStepperProps) {
  const current = TICKET_FLOW.indexOf(stage as (typeof TICKET_FLOW)[number]);
  return (
    <div className="relative overflow-x-auto pb-1">
      <ol aria-label="Ticket progress" className="m-0 flex min-w-[720px] list-none p-0">
        {TICKET_FLOW.map((step, index) => {
          const done = current >= 0 && index < current;
          const now = index === current;
          return (
            <li
              key={step}
              aria-current={now ? "step" : undefined}
              className={cn(
                "flex flex-1 flex-col gap-1.5 pr-1.5 text-xs",
                now ? "font-semibold text-text" : done ? "text-text" : "text-muted",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "h-1 rounded-full",
                  now ? "bg-accent" : done ? "bg-primary" : "bg-surface-3",
                )}
              />
              <span>
                {STAGE_DISPLAY[step].label}
                <span className="sr-only">{now ? " (current)" : done ? " (done)" : ""}</span>
              </span>
              <span className="font-normal text-muted">{times[step] ?? "—"}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
