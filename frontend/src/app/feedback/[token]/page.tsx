import type { Metadata } from "next";
import { CsatPage } from "@/features/feedback/csat";

export const metadata: Metadata = { title: "Service feedback" };

export default async function FeedbackPage(props: PageProps<"/feedback/[token]">) {
  const { token } = await props.params;
  return <CsatPage token={decodeURIComponent(token)} />;
}
