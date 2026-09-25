"use client";

import { CheckCircle2 } from "lucide-react";
import useSWR from "swr";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/states";
import { useSession } from "@/lib/auth/session";
import { fetcher, type TicketPage } from "./api";
import { TicketTable } from "./ticket-table";

/** Home-page card: the tickets closest to (or past) their SLA. */
export function NeedsAttention() {
  const { can } = useSession();
  const allowed = can("tickets.view");
  const { data, error, mutate } = useSWR<TicketPage>(
    allowed ? "/tickets?quick=sla-risk&sort=due&pageSize=6" : null,
    fetcher,
  );
  if (!allowed) return null;

  return (
    <Card aria-labelledby="attention-title">
      <CardHeader
        titleId="attention-title"
        title="Needs attention"
        meta={data ? `${data.meta.total} at SLA risk` : undefined}
        actions={
          <ButtonLink href="/tickets?quick=sla-risk" variant="ghost" size="sm">
            View all
          </ButtonLink>
        }
      />
      {!data && !error && <TableSkeleton rows={4} label="Loading tickets" />}
      {error && !data && <ErrorState title="Couldn't load tickets" onRetry={() => void mutate()} />}
      {data?.data.length === 0 && (
        <EmptyState
          icon={<CheckCircle2 className="size-6" />}
          title="Nothing at risk"
          description="Every open ticket is within its SLA."
        />
      )}
      {data && data.data.length > 0 && (
        <TicketTable tickets={data.data} caption="Tickets at risk of missing their SLA" compact />
      )}
    </Card>
  );
}
