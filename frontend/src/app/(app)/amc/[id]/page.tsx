import type { Metadata } from "next";
import { AmcDetailScreen } from "@/features/amc/amc-detail";

export async function generateMetadata(props: PageProps<"/amc/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: decodeURIComponent(id) };
}

export default async function AmcDetailPage(props: PageProps<"/amc/[id]">) {
  const { id } = await props.params;
  return <AmcDetailScreen id={decodeURIComponent(id)} />;
}
