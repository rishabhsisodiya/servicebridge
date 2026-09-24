import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "ok" | "warn" | "bad" | "info" | "prog" | "done" | "neutral";

const TONES: Record<Tone, string> = {
  ok: "text-ok bg-ok-bg",
  warn: "text-warn bg-warn-bg",
  bad: "text-bad bg-bad-bg",
  info: "text-info bg-info-bg",
  prog: "text-prog bg-prog-bg",
  done: "text-done bg-done-bg",
  neutral: "text-text bg-surface-3",
};

/**
 * Each tone has its own marker shape as well as colour, so status never
 * depends on colour alone: ● info/ok, ◆ in progress, ▲ warning, ■ error.
 */
const MARKERS: Record<Tone, string> = {
  ok: "rounded-full",
  info: "rounded-full",
  done: "rounded-full opacity-70",
  neutral: "rounded-full",
  prog: "rotate-45 rounded-[1px]",
  bad: "rounded-[1px]",
  warn: "[clip-path:polygon(50%_0,100%_100%,0_100%)]",
};

interface StatusPillProps {
  tone: Tone;
  children: ReactNode;
  /** Hide the shape marker (e.g. for counts). */
  plain?: boolean;
  className?: string;
}

export function StatusPill({ tone, children, plain, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full py-0.5 text-xs font-semibold whitespace-nowrap",
        plain ? "px-2" : "pr-2.5 pl-2",
        TONES[tone],
        className,
      )}
    >
      {!plain && (
        <span aria-hidden className={cn("size-[7px] shrink-0 bg-current", MARKERS[tone])} />
      )}
      {children}
    </span>
  );
}

export function Tag({
  children,
  icon,
  className,
}: {
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs whitespace-nowrap text-muted",
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
