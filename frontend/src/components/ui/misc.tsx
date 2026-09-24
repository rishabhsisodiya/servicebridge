import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full bg-surface-3 font-semibold text-text",
        size === "sm" && "size-6 text-[10px]",
        size === "md" && "size-8 text-xs",
        size === "lg" && "size-10 text-sm",
      )}
    >
      {initials(name)}
    </span>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

/** The page's h1. It takes focus after client navigation so screen readers announce the new page. */
export function PageHeader({ title, eyebrow, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">{eyebrow}</div>
        )}
        <h1 id="page-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {description && <p className="text-muted">{description}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap gap-2 max-sm:w-full sm:ml-auto [&>*]:max-sm:flex-1">
          {actions}
        </div>
      )}
    </div>
  );
}

interface FilterChipProps {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}

export function FilterChip({ pressed, onClick, children, count }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors",
        pressed
          ? "border-primary bg-primary text-on-primary"
          : "border-line-strong bg-surface text-text hover:bg-surface-2",
      )}
    >
      {children}
      {count !== undefined && <span className="text-[11px] opacity-80">{count}</span>}
    </button>
  );
}
