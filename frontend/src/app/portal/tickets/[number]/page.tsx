import type { Metadata } from "next";
import { PortalTicketDetail } from "@/features/portal/ticket-detail";

export const metadata: Metadata = { title: "Ticket" };

export default async function PortalTicketDetailPage(
  props: PageProps<"/portal/tickets/[number]">,
) {
  const params = await props.params;
  return <PortalTicketDetail number={params.number} />;
}
