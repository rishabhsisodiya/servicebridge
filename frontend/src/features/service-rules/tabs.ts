// Plain module (no "use client") so the server page can call isRuleTab.

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
