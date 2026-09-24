import { AlertTriangle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton h-4", className)} />;
}

/** Placeholder rows shaped like a table while data loads. */
export function TableSkeleton({ rows = 5, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3 p-4">
      <Skeleton className="w-1/3" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("h-9", i === rows - 1 && "w-4/5")} />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-5 py-10 text-center">
      <span
        className="grid size-12 place-items-center rounded-xl bg-surface-2 text-muted"
        aria-hidden
      >
        {icon}
      </span>
      <p className="font-semibold">{title}</p>
      {description && <p className="max-w-[42ch] text-muted">{description}</p>}
      {action}
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  description?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
}

export function ErrorState({ title, description, onRetry, retrying }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2.5 rounded-lg bg-bad-bg px-3.5 py-3 text-bad">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">{title}</p>
          {description && <p className="mt-0.5 text-text">{description}</p>}
        </div>
      </div>
      {onRetry && (
        <div>
          <Button
            size="sm"
            onClick={onRetry}
            loading={retrying}
            icon={<RefreshCw className="size-3.5" aria-hidden />}
          >
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
