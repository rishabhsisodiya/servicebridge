export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type CoverageKey = "AMC" | "WARRANTY" | "CHARGEABLE";
export type BillingUnit = "PER_VISIT" | "PER_HOUR" | "PER_KM" | "FIXED";

export const PRIORITY_ORDER: Priority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
export const COVERAGE_ORDER: CoverageKey[] = ["AMC", "WARRANTY", "CHARGEABLE"];
export const COVERAGE_LABEL: Record<CoverageKey, string> = {
  AMC: "Under AMC",
  WARRANTY: "In warranty",
  CHARGEABLE: "Chargeable",
};

export interface LabelRow {
  label: string;
  description: string | null;
  version: number;
}
export interface PriorityRow extends LabelRow {
  priority: Priority;
}
export interface StageRow extends LabelRow {
  stage: string;
}

export interface OpeningWindow {
  day: number;
  open: string;
  close: string;
}
export interface Holiday {
  date: string;
  name: string;
}

export interface CalendarRow {
  id: string;
  name: string;
  alwaysOpen: boolean;
  hours: OpeningWindow[];
  holidays: Holiday[];
  policyCount: number;
  version: number;
}

export interface SlaPolicyRow {
  id: string;
  coverage: CoverageKey;
  priority: Priority;
  responseMinutes: number;
  resolutionMinutes: number;
  calendarId: string;
  version: number;
  responseDueAt: string;
  resolutionDueAt: string;
}

export interface SlaData {
  timezone: string;
  now: string;
  policies: SlaPolicyRow[];
  calendars: CalendarRow[];
}

export interface ServiceTypeRow {
  id: string;
  name: string;
  description: string | null;
  defaultPriority: Priority;
  requiresEquipment: boolean;
  active: boolean;
  sortOrder: number;
  version: number;
}

export interface BillingRateRow {
  id: string;
  code: string;
  name: string;
  unit: BillingUnit;
  amount: number;
  erpItemCode: string | null;
  active: boolean;
  version: number;
}

export interface BillingData {
  rates: BillingRateRow[];
  sparesPriceList: string | null;
  amcPriceList: string | null;
  priceLists: { name: string; itemCount: number }[];
}

export interface RegionRow {
  id: string;
  name: string;
  isDemo: boolean;
  version: number;
  areaManager: { id: string; name: string } | null;
  pincodePrefixes: string[];
  userCount: number;
  siteCount: number;
}

export interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  equipmentModels: string[];
  isDemo: boolean;
  version: number;
  engineers: { id: string; name: string; status: string }[];
}

export interface SkillOptions {
  models: { code: string; name: string | null; machineCount: number }[];
  engineers: { id: string; name: string; region: string | null }[];
}
