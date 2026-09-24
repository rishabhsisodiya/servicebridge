import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Maps values to SVG points inside a w×h box with `pad` px of breathing room. */
export function sparklinePoints(
  values: number[],
  w: number,
  h: number,
  pad = 3,
): [number, number][] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values.map((v, i) => [i * step, h - pad - ((v - min) / range) * (h - pad * 2)]);
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const w = 72;
  const h = 28;
  const points = sparklinePoints(values, w, h);
  if (points.length < 2) return null;
  const line = points
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const [lx, ly] = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-7 w-[72px]", className)} aria-hidden>
      <path d={`${line} L${w} ${h} L0 ${h}Z`} fill="var(--surface-2)" />
      <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth="1.5" />
      <circle cx={lx} cy={ly} r="2.5" fill="var(--accent)" />
    </svg>
  );
}

interface KpiCardProps {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  trend?: number[];
  /** Draws attention to a figure that needs action. */
  alert?: boolean;
}

export function KpiCard({ label, value, detail, icon, trend, alert }: KpiCardProps) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col gap-1 overflow-hidden rounded-xl border bg-surface px-4 py-3.5 shadow-sm",
        alert ? "border-bad/40" : "border-line",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        {icon}
        {label}
      </span>
      <span
        className={cn("text-2xl leading-tight font-semibold tracking-tight", alert && "text-bad")}
      >
        {value}
      </span>
      {detail && (
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">{detail}</span>
      )}
      {trend && <Sparkline values={trend} className="absolute top-3.5 right-3 max-sm:hidden" />}
    </div>
  );
}
