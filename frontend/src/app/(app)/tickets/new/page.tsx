import type { Metadata } from "next";
import { findItemByHref } from "@/components/shell/nav-config";
import { PlannedPage } from "@/components/shell/planned-page";

export const metadata: Metadata = { title: "Log a ticket" };

// Needs its own route: otherwise tickets/[id] would treat "new" as a ticket number.
export default function NewTicketPage() {
  return <PlannedPage item={findItemByHref("/tickets/new")!} />;
}
