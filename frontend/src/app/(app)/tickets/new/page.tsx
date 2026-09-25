import type { Metadata } from "next";
import { NewTicketForm } from "@/features/tickets/new-ticket-form";

export const metadata: Metadata = { title: "Log a ticket" };

// Needs its own route: otherwise tickets/[id] would treat "new" as a ticket number.
export default async function NewTicketPage(props: PageProps<"/tickets/new">) {
  const { customerId } = await props.searchParams;
  return (
    <NewTicketForm initialCustomerId={typeof customerId === "string" ? customerId : undefined} />
  );
}
