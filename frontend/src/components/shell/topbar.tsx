"use client";

import { ChevronRight, LogOut, Menu, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconButton } from "@/components/ui/button";
import { Avatar } from "@/components/ui/misc";
import { Popover } from "@/components/ui/popover";
import { useSession } from "@/lib/auth/session";
import { NotificationBell } from "@/features/notifications/notification-bell";
import { buildCrumbs } from "./nav-config";
import { ThemeToggle } from "./theme-toggle";

interface TopbarProps {
  navOpen: boolean;
  onOpenNav: () => void;
  onOpenSearch: () => void;
}

export function Topbar({ navOpen, onOpenNav, onOpenSearch }: TopbarProps) {
  const pathname = usePathname();
  const crumbs = buildCrumbs(pathname);
  const { me, signOut } = useSession();
  const name = me?.user.name ?? "";

  return (
    <header className="sticky top-[env(safe-area-inset-top)] z-20 flex min-h-14 items-center gap-2 border-b border-line bg-bg/90 px-4 backdrop-blur-md lg:px-7">
      <IconButton
        label="Open navigation"
        aria-expanded={navOpen}
        aria-controls="app-nav"
        onClick={onOpenNav}
        className="lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </IconButton>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="m-0 flex list-none items-center gap-1.5 overflow-hidden p-0 text-[13px] whitespace-nowrap text-muted">
          {crumbs.map((crumb, index) => (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
              {crumb.href ? (
                <Link href={crumb.href} className="text-muted hover:text-text">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className="truncate font-semibold text-text">
                  {crumb.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Search (Ctrl K)"
        aria-keyshortcuts="Control+K Meta+K"
        className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-muted hover:border-line-strong max-md:size-10 max-md:justify-center max-md:border-transparent max-md:bg-transparent md:min-w-64"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="max-md:hidden">Search screens, tickets…</span>
        <kbd className="ml-auto rounded border border-line bg-surface-2 px-1.5 text-[11px] max-md:hidden">
          ⌘K
        </kbd>
      </button>

      <ThemeToggle />

      <NotificationBell />

      <Popover
        trigger={(props) => (
          <button
            type="button"
            aria-label={name ? `Account menu for ${name}` : "Account menu"}
            className="cursor-pointer rounded-full"
            {...props}
          >
            {name ? (
              <Avatar name={name} />
            ) : (
              <span className="block size-8 rounded-full bg-surface-3" />
            )}
          </button>
        )}
        className="w-60"
      >
        {(close) => (
          <div className="py-1.5">
            <div className="border-b border-line px-4 pt-1.5 pb-3">
              <p className="font-semibold">{name}</p>
              <p className="text-xs text-muted">
                {me?.user.roleLabel}
                {me?.user.region ? ` · ${me.user.region.name}` : ""}
              </p>
              <p className="truncate text-xs text-muted">{me?.user.email}</p>
            </div>
            <Link
              href="/account"
              onClick={close}
              className="flex items-center gap-2.5 px-4 py-2.5 text-text hover:bg-surface-2"
            >
              <UserRound className="size-4" aria-hidden />
              My account
            </Link>
            <button
              type="button"
              onClick={() => {
                close();
                void signOut();
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 border-t border-line px-4 py-2.5 text-left text-text hover:bg-surface-2"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </div>
        )}
      </Popover>
    </header>
  );
}
