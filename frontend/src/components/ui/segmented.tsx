"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SegmentedProps<V extends string> {
  label: string;
  options: { value: V; label: ReactNode }[];
  value: V;
  onChange: (value: V) => void;
  size?: "sm" | "md";
  className?: string;
}

/** A single-choice control with radio-group semantics and arrow-key support. */
export function Segmented<V extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
  className,
}: SegmentedProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex gap-0.5 rounded-[9px] bg-surface-2 p-[3px]", className)}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "cursor-pointer rounded-[7px] font-semibold transition-colors",
              size === "sm" ? "min-h-7 px-2.5 text-xs" : "min-h-8 px-3 text-[13px]",
              checked ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
