import type { Metadata } from "next";
import { PortalAmcDetail } from "@/features/portal/amc-detail";

export const metadata: Metadata = { title: "AMC contract" };

export default async function PortalAmcDetailPage(props: PageProps<"/portal/amc/[id]">) {
  const params = await props.params;
  return <PortalAmcDetail id={params.id} />;
}
