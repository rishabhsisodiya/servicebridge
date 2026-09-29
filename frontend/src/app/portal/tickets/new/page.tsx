import type { Metadata } from "next";
import { NewTicketForm } from "@/features/portal/new-ticket-form";

export const metadata: Metadata = { title: "Raise a ticket" };

export default function PortalNewTicketPage() {
  return <NewTicketForm />;
}
