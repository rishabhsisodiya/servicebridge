import type { Metadata } from "next";
import { isQuickFilter } from "@/features/tickets/quick-filters";
import { TicketsBrowser } from "@/features/tickets/tickets-browser";

export const metadata: Metadata = { title: "Tickets" };

export default async function TicketsPage(props: PageProps<"/tickets">) {
  const { quick, search } = await props.searchParams;
  return (
    <TicketsBrowser
      initialQuick={isQuickFilter(quick) ? quick : "open"}
      initialSearch={typeof search === "string" ? search : ""}
    />
  );
}
