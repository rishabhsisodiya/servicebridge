"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import useSWR from "swr";
import { ApiError } from "@/lib/api/client";
import { portalFetch, portalKeys } from "@/features/portal/api";
import type { PortalMe } from "@/features/portal/types";

interface PortalSessionValue {
  me: PortalMe | undefined;
  loading: boolean;
  error: ApiError | undefined;
  refresh: () => Promise<unknown>;
  signOut: () => Promise<void>;
}

const PortalSessionContext = createContext<PortalSessionValue | null>(null);

/** Pages where a 401 is expected (no session yet) and must not bounce. */
const PUBLIC_PORTAL_PATHS = ["/portal/login", "/portal/auth/verify"];

function isPublicPortalPath(pathname: string): boolean {
  return PUBLIC_PORTAL_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function PortalSessionProvider({ children }: { children: React.ReactNode }) {
  const { data, error, isLoading, mutate } = useSWR<PortalMe, ApiError>(
    portalKeys.me,
    (key: string) => portalFetch<PortalMe>(key),
    { revalidateOnFocus: true, shouldRetryOnError: false },
  );

  // The proxy already keeps signed-out visitors on the login/verify pages; this
  // covers a magic-link session that dies while the portal is open.
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      if (!isPublicPortalPath(window.location.pathname)) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load clears every cached screen from the previous session
        window.location.assign("/portal/login?signedOut=1");
      }
    }
  }, [error ]);

  const signOut = useCallback(async () => {
    try {
      await portalFetch("/portal/auth/logout", { method: "POST" });
    } finally {
      // A full navigation drops every cached screen and all in-memory state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load clears every cached screen from the previous session
      window.location.assign("/portal/login?signedOut=1");
    }
  }, []);

  const value = useMemo<PortalSessionValue>(
    () => ({ me: data, loading: isLoading, error, refresh: () => mutate(), signOut }),
    [data, isLoading, error, mutate, signOut],
  );

  return <PortalSessionContext.Provider value={value}>{children}</PortalSessionContext.Provider>;
}

/** The signed-in customer contact and their company. Throws outside the portal layout. */
export function usePortalSession(): PortalSessionValue {
  const value = useContext(PortalSessionContext);
  if (!value) throw new Error("usePortalSession must be used inside <PortalSessionProvider>");
  return value;
}
