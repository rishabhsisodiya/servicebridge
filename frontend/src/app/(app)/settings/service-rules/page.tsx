import type { Metadata } from "next";
import { isRuleTab, ServiceRulesScreen } from "@/features/service-rules/service-rules-screen";

export const metadata: Metadata = { title: "Service rules" };

export default async function ServiceRulesPage(props: PageProps<"/settings/service-rules">) {
  const { tab } = await props.searchParams;
  return <ServiceRulesScreen initialTab={isRuleTab(tab) ? tab : "sla"} />;
}
