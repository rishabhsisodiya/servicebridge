"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  count?: number;
}

interface TabsProps<K extends string> {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  /** Renders the active panel. */
  children: ReactNode;
  className?: string;
}

/** WAI-ARIA tabs: roving tabindex, arrow keys and Home/End move between tabs. */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  children,
  className,
}: TabsProps<K>) {
  const baseId = useId();
  const tabRefs = useRef(new Map<K, HTMLButtonElement>());

  const focusAt = (index: number) => {
    const item = items[(index + items.length) % items.length];
    onChange(item.key);
    tabRefs.current.get(item.key)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: items.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      focusAt(moves[event.key]);
    }
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 overflow-x-auto border-b border-line"
      >
        {items.map((item, index) => {
          const selected = item.key === value;
          return (
            <button
              key={item.key}
              ref={(node) => {
                if (node) tabRefs.current.set(item.key, node);
                else tabRefs.current.delete(item.key);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.key}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.key)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "-mb-px cursor-pointer border-b-2 px-3 py-2.5 text-sm font-semibold whitespace-nowrap",
                selected
                  ? "border-accent text-text"
                  : "border-transparent text-muted hover:text-text",
              )}
            >
              {item.label}
              {item.count !== undefined && (
                <span className="ml-1.5 rounded-full bg-surface-3 px-1.5 text-[11px]">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${value}`}
        className="pt-4"
      >
        {children}
      </div>
    </div>
  );
}
