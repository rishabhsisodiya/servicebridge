import type { Metadata } from "next";
import { PortalTicketsBrowser } from "@/features/portal/tickets-browser";

export const metadata: Metadata = { title: "My tickets" };

export default function PortalDashboardPage() {
  return <PortalTicketsBrowser />;
}
