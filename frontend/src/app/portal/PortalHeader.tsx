"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { usePortalSession } from "./PortalSessionProvider";

/** Portal header: brand, the customer's company, and sign-out. No staff AppShell. */
export function PortalHeader() {
  const { me, loading, signOut } = usePortalSession();

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full items-center gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/portal"
          className="flex min-w-0 items-center gap-2.5 rounded-lg no-underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-strong text-sm font-bold text-on-accent-strong"
          >
            ET
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[15px] font-semibold text-text">ERPTick</span>
            <span className="text-xs text-muted">Customer portal</span>
          </span>
        </Link>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {!loading && me && (
            <div className="hidden min-w-0 flex-col items-end leading-tight sm:flex">
              <span className="truncate text-[13px] font-semibold text-text">
                {me.customer.name}
              </span>
              <span className="truncate text-xs text-muted">{me.contact.fullName}</span>
            </div>
          )}
          {!loading && me && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void signOut()}
              icon={<LogOut className="size-4" aria-hidden />}
            >
              Sign out
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
