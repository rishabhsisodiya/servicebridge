/** Rounds up to 1, 2, 2.5 or 5 × 10^k so axis ticks land on readable numbers. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const multiple of [1, 2, 2.5, 5, 10]) {
    if (multiple * power >= value) return multiple * power;
  }
  return 10 * power;
}

export interface BarSeries {
  name: string;
  values: number[];
  /** A CSS colour, normally a --chart-N token. */
  color: string;
}

interface BarChartProps {
  labels: string[];
  series: BarSeries[];
  /** Optional target line drawn over the bars. */
  target?: { name: string; values: number[] };
  /** Describes the chart for screen readers, e.g. "Tickets logged vs closed per day". */
  title: string;
  width?: number;
  height?: number;
}

const TICKS = 4;

export function BarChart({
  labels,
  series,
  target,
  title,
  width = 640,
  height = 220,
}: BarChartProps) {
  const left = 40;
  const right = 10;
  const top = 10;
  const bottom = 26;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const max = niceMax(Math.max(...series.flatMap((s) => s.values), ...(target?.values ?? [])));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const group = plotW / labels.length;
  const barW = Math.min(22, (group * 0.62) / series.length);
  const gap = 3;

  return (
    <figure className="m-0 flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title}
        className="h-auto w-full"
      >
        {Array.from({ length: TICKS + 1 }, (_, k) => {
          const v = (max * k) / TICKS;
          return (
            <g key={k}>
              <line x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke="var(--line)" />
              <text x={left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
                {Number(v.toFixed(1)).toLocaleString()}
              </text>
            </g>
          );
        })}
        {labels.map((label, i) => {
          const cx = left + group * i + group / 2;
          const start = cx - (series.length * barW + (series.length - 1) * gap) / 2;
          return (
            <g key={label}>
              {series.map((s, j) => {
                const v = s.values[i] ?? 0;
                return (
                  <rect
                    key={s.name}
                    x={start + j * (barW + gap)}
                    y={y(v)}
                    width={barW}
                    height={top + plotH - y(v)}
                    rx="3"
                    fill={s.color}
                  >
                    <title>{`${label} · ${s.name}: ${v}`}</title>
                  </rect>
                );
              })}
              <text x={cx} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
                {label}
              </text>
            </g>
          );
        })}
        {target && (
          <path
            d={target.values
              .map((v, i) => `${i ? "L" : "M"}${left + group * i + group / 2} ${y(v)}`)
              .join(" ")}
            fill="none"
            stroke="var(--chart-4)"
            strokeWidth="2"
            strokeDasharray="5 4"
          />
        )}
      </svg>
      <figcaption className="flex flex-wrap gap-3.5 text-xs text-muted">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
        {target && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="w-3.5 border-t-2 border-dashed border-chart-4" />
            {target.name}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

interface HBarsProps {
  rows: { label: string; value: number; color?: string }[];
  label: string;
}

/** Horizontal bars for ranked lists ("open by stage", "top customers"). */
export function HBars({ rows, label }: HBarsProps) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-2.5 p-0">
      {rows.map((row) => (
        <li
          key={row.label}
          className="grid grid-cols-[minmax(90px,140px)_1fr_40px] items-center gap-2.5 text-[13px]"
        >
          <span className="truncate" title={row.label}>
            {row.label}
          </span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <span
              className="block h-full rounded-full"
              style={{
                width: `${(row.value / max) * 100}%`,
                background: row.color ?? "var(--chart-1)",
              }}
            />
          </span>
          <span className="text-right font-semibold">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}
