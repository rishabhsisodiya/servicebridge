"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CommandPalette } from "./command-palette";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const previousPath = useRef(pathname);
  const navOpenRef = useRef(navOpen);
  useEffect(() => {
    navOpenRef.current = navOpen;
  }, [navOpen]);
  const closeNav = useCallback(() => setNavOpen(false), []);
  // Dismissing without navigating (Escape, scrim) returns focus to the menu button.
  const dismissNav = useCallback(() => {
    setNavOpen(false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[aria-controls="app-nav"]')?.focus(),
    );
  }, []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // After a client-side navigation, move focus to the new page's heading so
  // screen readers announce it. Skipped on first load (the browser handles that).
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    document.getElementById("page-title")?.focus({ preventScroll: true });
  }, [pathname]);

  // The page behind is inert while the mobile drawer is open, so focus must move into it.
  useEffect(() => {
    if (navOpen) document.querySelector<HTMLElement>("#app-nav a")?.focus();
  }, [navOpen]);

  // ⌘K / Ctrl+K opens search from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape" && navOpenRef.current) dismissNav();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismissNav]);

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#main"
        className="fixed top-2 left-2 z-[100] -translate-y-20 rounded-lg bg-accent-strong px-3 py-2 font-semibold text-on-accent-strong focus:translate-y-0"
      >
        Skip to main content
      </a>

      {/* Desktop: sticky rail. Below lg: an off-canvas drawer with a scrim. */}
      <aside
        id="app-nav"
        aria-label="Navigation"
        className={cn(
          "z-40 w-[280px] transition-transform duration-200 lg:sticky lg:top-0 lg:h-dvh lg:w-auto lg:translate-x-0",
          "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:pt-[env(safe-area-inset-top)]",
          navOpen
            ? "max-lg:translate-x-0 max-lg:shadow-lg"
            : "max-lg:-translate-x-full max-lg:invisible",
        )}
      >
        <Sidebar onNavigate={closeNav} />
      </aside>
      {navOpen && (
        <div
          aria-hidden
          onClick={dismissNav}
          className="fixed inset-0 z-30 bg-[var(--scrim)] lg:hidden"
        />
      )}

      <div className="flex min-w-0 flex-col" inert={navOpen || undefined}>
        <Topbar
          navOpen={navOpen}
          onOpenNav={() => setNavOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
        />
        <main
          id="main"
          className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 pt-5 pb-12 lg:px-7 lg:pt-6"
        >
          {children}
        </main>
      </div>

      <CommandPalette open={searchOpen} onClose={closeSearch} />
    </div>
  );
}
