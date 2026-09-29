"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import useSWR from "swr";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { ErrorState, TableSkeleton } from "@/components/ui/states";
import { ApiError } from "@/lib/api/client";
import { portalFetch } from "./api";

/** Exchanges the ?token= from the magic-link email for a portal session. */
export function VerifyLink() {
  const router = useRouter();
  const token = useSearchParams().get("token");

  const key = token ? `/portal/auth/verify?token=${encodeURIComponent(token)}` : null;
  const { data, error, isLoading } = useSWR<{ ok: boolean }, ApiError>(
    key,
    (fetchKey: string) => portalFetch<{ ok: boolean }>(fetchKey),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  useEffect(() => {
    if (data?.ok) router.push("/portal");
  }, [data, router]);

  if (!token) {
    return (
      <Center>
        <PageHeader title="Sign-in link" />
        <Card>
          <ErrorState
            title="This link is incomplete"
            description="It looks like the sign-in link was cut off. Open the full link from the email we sent you."
          />
        </Card>
      </Center>
    );
  }

  if (isLoading || data?.ok) {
    return (
      <Center>
        <PageHeader title="Signing you in" />
        <Card>
          <TableSkeleton rows={3} label="Verifying your sign-in link" />
        </Card>
      </Center>
    );
  }

  const expired = error instanceof ApiError && error.code === "PORTAL_LINK_EXPIRED";
  return (
    <Center>
      <PageHeader title="Sign-in link" />
      <Card>
        <ErrorState
          title={expired ? "This link has expired" : "Couldn't sign you in"}
          description={
            expired
              ? "Sign-in links are one-time and expire quickly. Request a fresh one below."
              : (error instanceof ApiError ? error.message : undefined)
          }
        />
      </Card>
    </Center>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-8">{children}</div>;
}
