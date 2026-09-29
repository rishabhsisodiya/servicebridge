"use client";

import { AlertTriangle } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Props a Field hands to its control so label, help and error are all wired up. */
export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  required?: boolean;
}

interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

export function Field({ label, help, error, required, className, children }: FieldProps) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
        {required && (
          <span className="text-bad" aria-hidden>
            {" "}
            *
          </span>
        )}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        required,
      })}
      {error && (
        <p id={errorId} className="flex items-center gap-1.5 text-xs font-semibold text-bad">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      {help && (
        <div id={helpId} className="text-xs text-muted">
          {help}
        </div>
      )}
    </div>
  );
}

const control = cn(
  "w-full min-h-10 rounded-lg border border-control-border bg-surface px-3 py-2 text-text",
  "placeholder:text-faint max-sm:text-base",
  "focus:border-accent focus:outline-2 focus:outline-offset-0 focus:outline-accent/50",
  "aria-invalid:border-bad aria-invalid:bg-bad-bg/40",
  "read-only:bg-surface-2 disabled:cursor-not-allowed disabled:bg-surface-2",
);

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(control, className)} {...rest} />;
}

export function Select({ className, ...rest }: ComponentProps<"select">) {
  return <select className={cn(control, "cursor-pointer pr-8", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 resize-y", className)} {...rest} />;
}
