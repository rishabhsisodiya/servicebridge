"use client";

import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { useAppSettings } from "@/lib/app-settings";
import { useSession } from "@/lib/auth/session";

/** Reminds everyone that fictional demo records are loaded. */
export function DemoBanner() {
  const { data } = useAppSettings();
  const { can } = useSession();
  if (!data?.demo.active) return null;
  return (
    <div
      role="note"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-info-bg px-4 py-2 text-[13px] text-info lg:px-7"
    >
      <FlaskConical className="size-4 shrink-0" aria-hidden />
      <span className="text-text">
        Demo data is loaded. Customers, machines and demo users marked as demo are fictional.
      </span>
      {can("settings.manage") && (
        <Link
          href="/settings/company"
          className="font-semibold text-info underline underline-offset-2"
        >
          Manage demo data
        </Link>
      )}
    </div>
  );
}
