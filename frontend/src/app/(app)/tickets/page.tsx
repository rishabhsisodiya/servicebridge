import { Download, Plus } from "lucide-react";
import type { Metadata } from "next";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { TicketsBrowser } from "@/features/tickets/tickets-browser";

export const metadata: Metadata = { title: "Tickets" };

export default function TicketsPage() {
  return (
    <>
      <PageHeader
        title="Tickets"
        description="38 open · 3 at SLA risk"
        actions={
          <>
            <Button
              icon={<Download className="size-4" aria-hidden />}
              disabled
              title="Export arrives with reports in session 14"
            >
              Export
            </Button>
            <ButtonLink
              href="/tickets/new"
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
            >
              Log a ticket
            </ButtonLink>
          </>
        }
      />
      <TicketsBrowser />
    </>
  );
}
