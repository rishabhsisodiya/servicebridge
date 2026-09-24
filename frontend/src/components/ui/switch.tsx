"use client";

import { cn } from "@/lib/cn";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name, e.g. "Weekly clean-up". The on/off state is announced by role="switch". */
  label: string;
  disabled?: boolean;
  busy?: boolean;
}

/** An on/off toggle for settings that take effect immediately. */
export function Switch({ checked, onChange, label, disabled, busy }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-accent-strong" : "bg-line-strong",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block size-5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
