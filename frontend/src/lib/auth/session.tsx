"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";

/**
 * Mirrors backend/src/auth/permissions.ts. The server enforces permissions on
 * every request; the web app only uses them to decide what to show.
 */
export type Permission =
  | "tickets.read"
  | "tickets.create"
  | "tickets.edit"
  | "visits.read"
  | "visits.create"
  | "visits.edit"
  | "visits.delete"
  | "quotations.read"
  | "quotations.create"
  | "quotations.edit"
  | "quotations.delete"
  | "writebacks.read"
  | "writebacks.edit"
  | "customers.read"
  | "equipment.read"
  | "items.read"
  | "rules.read"
  | "rules.edit"
  | "users.read"
  | "users.create"
  | "users.edit"
  | "users.delete"
  | "roles.read"
  | "roles.create"
  | "roles.edit"
  | "roles.delete"
  | "company.read"
  | "company.edit"
  | "erp.read"
  | "erp.edit"
  | "automations.read"
  | "automations.edit"
  | "system.read"
  | "system.edit"
  | "audit.read"
  | "partner.read"
  | "partner.edit"
  | "imports.read"
  | "imports.edit"
  | "audit.edit"
  | "tickets.assign"
  | "tickets.work"
  | "tickets.verify"
  | "tickets.escalations"
  | "demo.manage"
  | "amc.read"
  | "amc.edit"
  | "reports.read"
  | "reports.schedule";

export type TicketScope = "ALL" | "REGION" | "OWN";

export interface Me {
  user: {
    id: string;
    email: string;
    name: string;
    role: { id: string; name: string; ticketScope: TicketScope };
    status: "INVITED" | "ACTIVE" | "DEACTIVATED";
    region: { id: string; name: string } | null;
  };
  permissions: Permission[];
}

export const ME_KEY = "/auth/me";

interface SessionValue {
  me: Me | undefined;
  loading: boolean;
  /** True when the user may do this. While loading, nothing is allowed. */
  can: (permission: Permission) => boolean;
  refresh: () => Promise<unknown>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, mutate } = useSWR<Me>(ME_KEY, (key: string) => apiFetch<Me>(key), {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });

  const permissions = useMemo(() => new Set(data?.permissions ?? []), [data]);
  const can = useCallback((permission: Permission) => permissions.has(permission), [permissions]);

  const signOut = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST", noAuthRedirect: true });
    } finally {
      // A full navigation drops every cached screen and all in-memory state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load clears every cached screen from the previous session
      window.location.assign("/login?signedOut=1");
    }
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ me: data, loading: isLoading, can, refresh: () => mutate(), signOut }),
    [data, isLoading, can, mutate, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}
