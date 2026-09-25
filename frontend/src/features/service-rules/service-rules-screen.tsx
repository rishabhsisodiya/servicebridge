"use client";

import { Lock } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { useSession } from "@/lib/auth/session";
import type { PriorityRow, StageRow } from "./api";
import { BillingTab } from "./billing-tab";
import { CalendarsTab } from "./calendars-tab";
import { LabelsTab } from "./labels-tab";
import { ServiceTypesTab } from "./service-types-tab";
import { SlaTab } from "./sla-tab";

export const RULE_TABS = [
  { key: "sla", label: "SLA policies" },
  { key: "calendars", label: "Calendars" },
  { key: "service-types", label: "Service types" },
  { key: "priorities", label: "Priorities" },
  { key: "stages", label: "Stage labels" },
  { key: "billing", label: "Billing" },
] as const;

export type RuleTab = (typeof RULE_TABS)[number]["key"];

export function isRuleTab(value: unknown): value is RuleTab {
  return RULE_TABS.some((t) => t.key === value);
}

export function ServiceRulesScreen({ initialTab }: { initialTab: RuleTab }) {
  const { can, me } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<RuleTab>(initialTab);

  if (me && !can("settings.manage")) {
    return (
      <>
        <PageHeader title="Service rules" />
        <Card>
          <EmptyState icon={<Lock className="size-6" />} title="You don't have access to this" />
        </Card>
      </>
    );
  }

  const change = (next: RuleTab) => {
    setTab(next);
    // Keeps the tab on reload and makes each tab linkable from Settings.
    router.replace(`${pathname}?tab=${next}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        title="Service rules"
        description="How tickets are timed, classified and billed. Changes apply to everyone."
      />
      <Tabs
        label="Service rules"
        value={tab}
        onChange={change}
        items={RULE_TABS.map((t) => ({ ...t }))}
      >
        {tab === "sla" && <SlaTab />}
        {tab === "calendars" && <CalendarsTab />}
        {tab === "service-types" && <ServiceTypesTab />}
        {tab === "priorities" && (
          <LabelsTab<PriorityRow>
            endpoint="/service-rules/priorities"
            keyOf={(r) => r.priority}
            title="Priorities"
            meta="Four fixed levels; SLA targets are set per level. You can rename them and explain when to use each."
            noun="priority"
          />
        )}
        {tab === "stages" && (
          <LabelsTab<StageRow>
            endpoint="/service-rules/stages"
            keyOf={(r) => r.stage}
            title="Stage labels"
            meta="The ticket workflow is fixed; these are the names people see for each step."
            noun="stage"
          />
        )}
        {tab === "billing" && <BillingTab />}
      </Tabs>
    </>
  );
}
