"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface PopoverProps {
  /** Renders the trigger; spread the given props onto a <button>. */
  trigger: (props: {
    "aria-expanded": boolean;
    "aria-controls": string;
    onClick: () => void;
  }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  className?: string;
}

/** Non-modal panel anchored to a button. Closes on Escape, outside click, or `close()`. */
export function Popover({ trigger, children, align = "end", className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const onPointer = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      root?.querySelector<HTMLButtonElement>("[aria-controls]")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({
        "aria-expanded": open,
        "aria-controls": panelId,
        onClick: () => setOpen((v) => !v),
      })}
      <div
        id={panelId}
        hidden={!open}
        className={cn(
          "absolute top-[calc(100%+6px)] z-[60] w-[min(360px,calc(100vw-32px))] animate-pop rounded-xl border border-line bg-surface shadow-lg",
          align === "end" ? "right-0" : "left-0",
          className,
        )}
      >
        {open && children(() => setOpen(false))}
      </div>
    </div>
  );
}
