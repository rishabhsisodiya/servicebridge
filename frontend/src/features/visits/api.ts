import { API_BASE, apiFetch, type ApiRequestInit } from "@/lib/api/client";

/** Stages in which the API lets a visit be started. Mirrors the backend's VISIT_STAGES. */
export const VISIT_STAGES = ["ON_SITE", "IN_PROGRESS"] as const;

export type VisitStatus = "DRAFT" | "SUBMITTED";

export interface VisitSummary {
  id: string;
  ticketId: string;
  visitNumber: number;
  status: VisitStatus;
  workDone: string | null;
  signatoryName: string | null;
  hasSignature: boolean;
  signatureRefused: boolean;
  refusalReason: string | null;
  submittedAt: string | null;
  submittedBy: { name: string } | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  _count: { spares: number; photos: number };
}

export interface VisitSpareLine {
  id: string;
  quantity: number;
  item: { id: string; itemCode: string; name: string; uom: string | null };
}

export interface VisitPhotoRow {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface VisitDetail extends Omit<VisitSummary, "_count"> {
  spares: VisitSpareLine[];
  photos: VisitPhotoRow[];
  createdBy: { name: string } | null;
}

export interface SpareItemOption {
  id: string;
  itemCode: string;
  name: string;
  uom: string | null;
}

export interface AddSpareResult extends VisitSpareLine {
  stockWarning: boolean;
  availableStock: number;
}

const post = <T>(path: string, init?: ApiRequestInit) =>
  apiFetch<T>(path, { method: "POST", ...init });

export const listVisits = (ticketId: string) =>
  apiFetch<VisitSummary[]>(`/visits/ticket/${ticketId}`);

export const createVisit = (ticketId: string) =>
  post<VisitDetail>("/visits", { json: { ticketId } });

export const getVisit = (id: string) => apiFetch<VisitDetail>(`/visits/${id}`);

export const saveVisit = (
  id: string,
  body: { workDone?: string; signatoryName?: string | null; version: number },
) => apiFetch<VisitDetail>(`/visits/${id}`, { method: "PATCH", json: body });

export const deleteVisit = (id: string) =>
  apiFetch<void>(`/visits/${id}`, { method: "DELETE" });

export const submitVisit = (id: string) => post<VisitDetail>(`/visits/${id}/submit`);

export const addSpare = (id: string, itemId: string, quantity: number) =>
  post<AddSpareResult>(`/visits/${id}/spares`, { json: { itemId, quantity } });

export const updateSpare = (id: string, spareId: string, quantity: number) =>
  apiFetch<VisitSpareLine>(`/visits/${id}/spares/${spareId}`, {
    method: "PATCH",
    json: { quantity },
  });

export const removeSpare = (id: string, spareId: string) =>
  apiFetch<void>(`/visits/${id}/spares/${spareId}`, { method: "DELETE" });

const upload = <T>(path: string, file: Blob, fileName: string) => {
  const form = new FormData();
  form.append("file", file, fileName);
  return post<T>(path, { form });
};

export const addPhoto = (id: string, file: File) =>
  upload<VisitPhotoRow>(`/visits/${id}/photos`, file, file.name);

export const removePhoto = (id: string, photoId: string) =>
  apiFetch<void>(`/visits/${id}/photos/${photoId}`, { method: "DELETE" });

export const setSignature = (id: string, png: Blob) =>
  upload<{ hasSignature: boolean }>(`/visits/${id}/signature`, png, "signature.png");

export const refuseSignature = (id: string, reason: string) =>
  post<{ hasSignature: boolean; signatureRefused: boolean }>(
    `/visits/${id}/signature/refuse`,
    { json: { reason } },
  );

export const visitPhotoUrl = (visitId: string, photoId: string) =>
  `${API_BASE}/visits/${visitId}/photos/${photoId}`;

interface ItemPage {
  data: Array<{
    id: string;
    itemCode: string;
    name: string;
    uom: string | null;
  }>;
}

/** Spare-part picker search. The backend only warns on low stock, never blocks. */
export const searchSpareItems = async (search: string): Promise<SpareItemOption[]> => {
  const params = new URLSearchParams({ page: "1", pageSize: "10" });
  if (search.trim()) params.set("search", search.trim());
  const page = await apiFetch<ItemPage>(`/items?${params}`);
  return page.data.map((i) => ({
    id: i.id,
    itemCode: i.itemCode,
    name: i.name,
    uom: i.uom,
  }));
};
