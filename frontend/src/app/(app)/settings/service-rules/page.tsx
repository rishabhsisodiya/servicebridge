import type { Metadata } from "next";
import { ServiceRulesScreen } from "@/features/service-rules/service-rules-screen";
import { isRuleTab } from "@/features/service-rules/tabs";

export const metadata: Metadata = { title: "Service rules" };

export default async function ServiceRulesPage(props: PageProps<"/settings/service-rules">) {
  const { tab } = await props.searchParams;
  return <ServiceRulesScreen initialTab={isRuleTab(tab) ? tab : "sla"} />;
}
