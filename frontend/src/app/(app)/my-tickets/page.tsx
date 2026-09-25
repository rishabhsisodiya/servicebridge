import type { Metadata } from "next";
import { TicketsBrowser } from "@/features/tickets/tickets-browser";

export const metadata: Metadata = { title: "My tickets" };

export default function MyTicketsPage() {
  return <TicketsBrowser initialQuick="mine" initialSearch="" title="My tickets" />;
}
