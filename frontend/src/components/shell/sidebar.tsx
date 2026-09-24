"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { findActiveItem, isVisible, NAV } from "./nav-config";

export function BrandMark() {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="grid size-8 place-items-center rounded-lg bg-rail-accent font-mono text-[13px] font-bold text-[#022c22]"
      >
        SB
      </span>
      <span className="leading-tight">
        <span className="block text-[14px] font-semibold tracking-wide text-white">
          ServiceBridge
        </span>
        <span className="block text-[11px] text-rail-muted">Service &amp; ERP operations</span>
      </span>
    </span>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = findActiveItem(pathname);
  const { can, loading } = useSession();

  return (
    <div className="flex h-full flex-col bg-rail text-rail-text">
      <div className="px-4 pt-4 pb-3">
        <Link href="/" onClick={onNavigate} className="rounded-lg" aria-label="ServiceBridge home">
          <BrandMark />
        </Link>
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-4 overflow-y-auto px-2.5 pb-4">
        {loading && (
          <div role="status" aria-label="Loading menu" className="flex flex-col gap-2 px-2.5 pt-2">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="h-7 rounded-md bg-rail-2" />
            ))}
          </div>
        )}
        {NAV.map((group) => {
          const items = group.items.filter((item) => !item.hidden && isVisible(item, can));
          if (items.length === 0) return null;
          return (
            <div key={group.label}>
              <h2 className="mb-1 px-2.5 text-[10.5px] font-semibold tracking-[0.12em] text-rail-muted uppercase">
                {group.label}
              </h2>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {items.map((item) => {
                  const current = active?.href === item.href;
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={current ? "page" : undefined}
                        className={cn(
                          "relative flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] no-underline transition-colors",
                          "focus-visible:outline-rail-accent",
                          current
                            ? "bg-rail-2 font-semibold text-white"
                            : "text-rail-text hover:bg-rail-2",
                        )}
                      >
                        {current && (
                          <span
                            aria-hidden
                            className="absolute top-2 bottom-2 -left-2.5 w-[3px] rounded-r bg-rail-accent"
                          />
                        )}
                        <Icon className="size-4 shrink-0 opacity-90" aria-hidden />
                        <span className="truncate">{item.label}</span>
                        {item.plannedSession && (
                          <span
                            className="ml-auto text-[10.5px] text-rail-muted"
                            title={`Arrives in build session ${item.plannedSession}`}
                          >
                            Soon
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="flex flex-col gap-1 border-t border-white/10 px-4 py-3 text-xs text-rail-muted">
        <span className="font-semibold text-rail-text">Apex Crushing Systems</span>
        <span>Demo company · sample data</span>
      </div>
    </div>
  );
}
