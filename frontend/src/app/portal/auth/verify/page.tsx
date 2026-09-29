import type { Metadata } from "next";
import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { TableSkeleton } from "@/components/ui/states";
import { VerifyLink } from "@/features/portal/verify-link";

export const metadata: Metadata = { title: "Verify sign-in link" };

export default function PortalVerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-8">
          <PageHeader title="Signing you in" />
          <Card>
            <TableSkeleton rows={3} label="Verifying your sign-in link" />
          </Card>
        </div>
      }
    >
      <VerifyLink />
    </Suspense>
  );
}
