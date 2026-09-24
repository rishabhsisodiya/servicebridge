"use client";

import { CornerDownLeft, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSession } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { searchCommands, type Command } from "./command-search";
import { isVisible, NAV, QUICK_LINKS } from "./nav-config";

const COMMANDS: Command[] = [
  ...NAV.flatMap((group) =>
    group.items.map((item) => ({
      id: item.href,
      group: group.label,
      label: item.label,
      hint: item.summary,
      href: item.href,
      item,
    })),
  ),
  ...QUICK_LINKS.map((item) => ({
    id: `quick:${item.href}`,
    group: "Account",
    label: item.label,
    hint: item.summary,
    href: item.href,
    item,
  })),
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/** ⌘K search over every screen. Combobox + listbox pattern; tickets and customers join in later sessions. */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const { can } = useSession();
  const allowed = useMemo(() => COMMANDS.filter((command) => isVisible(command.item, can)), [can]);
  const results = useMemo(() => searchCommands(allowed, query), [allowed, query]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = () => {
    setQuery("");
    setActiveIndex(0);
    onClose();
  };

  const go = (command: Command | undefined) => {
    if (!command) return;
    close();
    router.push(command.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (results.length ? (i + step + results.length) % results.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[activeIndex]);
    }
  };

  const optionId = (index: number) => `${listId}-option-${index}`;

  return (
    <dialog
      ref={dialogRef}
      aria-label="Search"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => event.target === event.currentTarget && close()}
      className="mx-auto mt-[12vh] w-[min(600px,calc(100vw-32px))] rounded-2xl border border-line bg-surface p-0 text-text shadow-lg open:animate-pop"
    >
      {open && (
        <div>
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search className="size-[18px] shrink-0 text-muted" aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={results.length ? optionId(activeIndex) : undefined}
              aria-autocomplete="list"
              aria-label="Search screens and actions"
              placeholder="Search screens, tickets, customers…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKeyDown}
              className="min-h-14 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
            />
            <kbd className="rounded border border-line bg-surface-2 px-1.5 text-[11px] text-muted">
              Esc
            </kbd>
          </div>
          <ul
            id={listId}
            role="listbox"
            aria-label="Results"
            className="m-0 max-h-[50vh] list-none overflow-y-auto p-1.5"
          >
            {results.length === 0 && (
              <li role="presentation" className="px-3 py-8 text-center text-muted">
                No matches for “{query}”. Try a screen name such as “tickets” or “finance”.
              </li>
            )}
            {results.map((command, index) => {
              const Icon = command.item.icon;
              const active = index === activeIndex;
              return (
                <li
                  key={command.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={active}
                  onClick={() => go(command)}
                  onMouseMove={() => setActiveIndex(index)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5",
                    active && "bg-surface-2",
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{command.label}</span>
                    <span className="block truncate text-xs text-muted">{command.hint}</span>
                  </span>
                  <span className="text-[11px] text-muted">{command.group}</span>
                  {active && <CornerDownLeft className="size-3.5 text-muted" aria-hidden />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </dialog>
  );
}
