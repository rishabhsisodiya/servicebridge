import { apiFetch } from "@/lib/api/client";

export type AmcStatus = "DRAFT" | "ACTIVE" | "EXPIRED" | "CANCELLED";
export type BillingUnit = "PER_VISIT" | "PER_HOUR" | "PER_KM" | "FIXED";
export type PlannedVisitStatus = "PLANNED" | "CREATED" | "SKIPPED";

export const AMC_STATUSES: AmcStatus[] = ["DRAFT", "ACTIVE", "EXPIRED", "CANCELLED"];

/** A row of GET /amc. `value` arrives as a Decimal string (or null). */
export interface AmcRow {
  id: string;
  number: string;
  customer: { id: string; name: string };
  status: AmcStatus;
  startsOn: string;
  endsOn: string;
  billingUnit: BillingUnit;
  value: string | null;
  equipmentCount: number;
  plannedVisitCount: number;
  version: number;
}

export interface AmcPage {
  data: AmcRow[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AmcEquipmentRow {
  equipmentId: string;
  equipment: { id: string; itemName: string | null; serialNo: string };
}

export interface AmcPlannedVisit {
  id: string;
  equipmentId: string | null;
  plannedOn: string;
  ticketId: string | null;
  status: PlannedVisitStatus;
}

/** Full contract from GET /amc/:id. */
export interface AmcDetail {
  id: string;
  number: string;
  customer: { id: string; name: string; email: string | null; mobile: string | null };
  status: AmcStatus;
  startsOn: string;
  endsOn: string;
  billingUnit: BillingUnit;
  value: string | null;
  serviceTypeId: string | null;
  serviceType: { id: string; name: string } | null;
  preferredEngineerId: string | null;
  preferredEngineer: { id: string; name: string; status: string } | null;
  notes: string | null;
  equipment: AmcEquipmentRow[];
  plannedVisits: AmcPlannedVisit[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AmcFilters {
  search: string;
  status: "" | AmcStatus;
  page: number;
}

export function amcKey(filters: AmcFilters): string {
  const params = new URLSearchParams({
    page: String(filters.page),
    pageSize: "25",
  });
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.status) params.set("status", filters.status);
  return `/amc?${params}`;
}

export interface NewAmcValues {
  customerId: string;
  startsOn: string;
  endsOn: string;
  billingUnit: BillingUnit;
  value: string;
  serviceTypeId: string;
  preferredEngineerId: string;
  notes: string;
  equipmentIds: string[];
  /** Planned visit dates (YYYY-MM-DD); saved one by one after the contract is created. */
  visitDates: string[];
}

export const amcApi = {
  create: (body: {
    customerId: string;
    startsOn: string;
    endsOn: string;
    billingUnit: BillingUnit;
    value?: number;
    serviceTypeId?: string;
    preferredEngineerId?: string;
    notes?: string;
    equipmentIds?: string[];
  }) => apiFetch<AmcDetail>("/amc", { method: "POST", json: body }),

  update: (
    id: string,
    body: {
      version: number;
      startsOn?: string;
      endsOn?: string;
      billingUnit?: BillingUnit;
      value?: number | null;
      serviceTypeId?: string | null;
      preferredEngineerId?: string | null;
      notes?: string | null;
    },
  ) => apiFetch<AmcDetail>(`/amc/${id}`, { method: "PATCH", json: body }),

  activate: (id: string, version: number) =>
    apiFetch<AmcDetail>(`/amc/${id}/activate`, { method: "POST", json: { version } }),

  cancel: (id: string, version: number) =>
    apiFetch<AmcDetail>(`/amc/${id}/cancel`, { method: "POST", json: { version } }),

  addEquipment: (id: string, equipmentId: string) =>
    apiFetch<AmcDetail>(`/amc/${id}/equipment`, { method: "POST", json: { equipmentId } }),

  removeEquipment: (id: string, equipmentId: string) =>
    apiFetch<AmcDetail>(`/amc/${id}/equipment/${equipmentId}`, { method: "DELETE" }),

  addVisit: (id: string, plannedOn: string, equipmentId?: string) =>
    apiFetch<AmcDetail>(`/amc/${id}/visits`, {
      method: "POST",
      json: equipmentId ? { plannedOn, equipmentId } : { plannedOn },
    }),

  /** Removes a planned visit. Only PLANNED visits can be removed; the backend rejects the rest. */
  removeVisit: (id: string, visitId: string) =>
    apiFetch<{ removed: boolean }>(`/amc/${id}/visits/${visitId}`, { method: "DELETE" }),
};
