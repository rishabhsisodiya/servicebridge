import type { Metadata } from "next";
import { TicketDetailScreen } from "@/features/tickets/ticket-detail";

export async function generateMetadata(props: PageProps<"/tickets/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: decodeURIComponent(id) };
}

export default async function TicketDetailPage(props: PageProps<"/tickets/[id]">) {
  const { id } = await props.params;
  return <TicketDetailScreen id={decodeURIComponent(id)} />;
}
