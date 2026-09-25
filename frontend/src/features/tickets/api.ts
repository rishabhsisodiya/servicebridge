"use client";

import useSWR from "swr";
import { apiFetch } from "@/lib/api/client";
import { type Priority, STAGE_DISPLAY, type TicketStage } from "./display";

export type Coverage = "AMC" | "WARRANTY" | "CHARGEABLE";
export type Channel = "PHONE" | "EMAIL" | "WHATSAPP" | "PORTAL" | "AMC_VISIT" | "PARTNER";
export type SlaClock = "response" | "resolution";
export type SlaStateKey = "ok" | "risk" | "breach" | "paused" | "met" | "none";

export type TicketAction =
  | "triage"
  | "assign"
  | "accept"
  | "decline"
  | "arrive"
  | "start"
  | "hold"
  | "resume"
  | "resolve"
  | "verify"
  | "reject"
  | "close"
  | "cancel"
  | "reopen";

export const CHANNEL_LABEL: Record<Channel, string> = {
  PHONE: "Phone",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  PORTAL: "Portal",
  AMC_VISIT: "AMC visit",
  PARTNER: "Partner",
};

export const COVERAGE_LABEL: Record<Coverage, string> = {
  AMC: "AMC",
  WARRANTY: "Warranty",
  CHARGEABLE: "Chargeable",
};

export interface SlaStatus {
  clock: SlaClock;
  state: SlaStateKey;
  dueAt: string | null;
  metAt: string | null;
}

export interface TicketRow {
  id: string;
  number: string;
  title: string;
  stage: TicketStage;
  priority: Priority;
  coverage: Coverage;
  channel: Channel;
  isDemo: boolean;
  createdAt: string;
  customer: { id: string; name: string };
  site: { id: string; title: string; city: string | null; pincode: string | null } | null;
  equipment: {
    id: string;
    serialNo: string;
    itemCode: string | null;
    itemName: string | null;
  } | null;
  engineer: { id: string; name: string } | null;
  region: { id: string; name: string } | null;
  sla: SlaStatus;
  version: number;
}

export type QuickFilter =
  "open" | "mine" | "sla-risk" | "unassigned" | "awaiting-verification" | "chargeable" | "closed";

export interface TicketPage {
  data: TicketRow[];
  meta: { page: number; pageSize: number; total: number };
  counts: Record<QuickFilter, number>;
}

export type TicketEventType =
  | "CREATED"
  | "ROUTED"
  | "ASSIGNED"
  | "STAGE_CHANGED"
  | "NOTE"
  | "PRIORITY_CHANGED"
  | "ATTACHMENT"
  | "SLA_AT_RISK"
  | "SLA_BREACHED"
  | "REOPENED";

export interface TicketEvent {
  id: string;
  type: TicketEventType;
  actor: { id: string; name: string } | null;
  fromStage: TicketStage | null;
  toStage: TicketStage | null;
  note: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: { id: string; name: string } | null;
}

export interface TicketDetail extends Omit<TicketRow, "customer" | "site" | "equipment"> {
  description: string | null;
  customer: {
    id: string;
    name: string;
    mobile: string | null;
    email: string | null;
    territory: string | null;
  };
  site: {
    id: string;
    title: string;
    line1: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  } | null;
  equipment: {
    id: string;
    serialNo: string;
    itemCode: string | null;
    itemName: string | null;
    warrantyExpiresOn: string | null;
    amcExpiresOn: string | null;
  } | null;
  contact: {
    id: string;
    fullName: string;
    mobile: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  serviceType: { id: string; name: string };
  areaManager: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  duplicateOf: { id: string; number: string } | null;
  coverageUntil: string | null;
  holdReason: string | null;
  stageBeforeHold: TicketStage | null;
  reopenCount: number;
  targets: { responseMinutes: number; resolutionMinutes: number };
  dates: {
    responseDueAt: string;
    resolutionDueAt: string;
    respondedAt: string | null;
    resolvedAt: string | null;
    verifiedAt: string | null;
    closedAt: string | null;
    cancelledAt: string | null;
    pausedAt: string | null;
  };
  breached: { response: boolean; resolution: boolean };
  openForCustomer: number;
  openForMachine: number;
  events: TicketEvent[];
  attachments: Attachment[];
  actions: TicketAction[];
}

export interface ServiceTypeOption {
  id: string;
  name: string;
  description: string | null;
  defaultPriority: Priority;
  requiresEquipment: boolean;
}

export interface TicketLookups {
  serviceTypes: ServiceTypeOption[];
  priorities: { priority: Priority; label: string; description: string | null }[];
  stages: { stage: TicketStage; label: string; description: string | null }[];
  actions: Record<TicketAction, { label: string; note: "required" | "optional" }>;
}

export interface EngineerSuggestion {
  id: string;
  name: string;
  region: string | null;
  dutyStatus: "ON_DUTY" | "OFF_DUTY" | "ON_LEAVE";
  onVisit: boolean;
  sameRegion: boolean;
  skills: string[];
  openTickets: number;
  current: boolean;
}

export interface ScheduledTimers {
  available: boolean;
  timers: { kind: "risk" | "breach"; clock: SlaClock; runAt: string; state: string }[];
}

export const fetcher = <T>(key: string) => apiFetch<T>(key);

export const LOOKUPS_KEY = "/tickets/lookups";

/** Labels and choices shared by every ticket screen; fetched once and cached. */
export function useTicketLookups() {
  return useSWR<TicketLookups>(LOOKUPS_KEY, fetcher, { revalidateOnFocus: false });
}

/** Stage and priority names as the admin set them, falling back to the defaults while loading. */
export function useTicketLabels() {
  const { data } = useTicketLookups();
  return {
    stage: (stage: TicketStage) =>
      data?.stages.find((s) => s.stage === stage)?.label ?? STAGE_DISPLAY[stage].label,
    priority: (priority: Priority) =>
      data?.priorities.find((p) => p.priority === priority)?.label ??
      priority.charAt(0) + priority.slice(1).toLowerCase(),
  };
}
