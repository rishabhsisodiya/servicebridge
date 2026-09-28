import { apiFetch, type ApiRequestInit } from "@/lib/api/client";

export type QuotationStatus =
  | "DRAFT"
  | "SENT"
  | "PO_RECEIVED"
  | "EXPIRED"
  | "REVISED"
  | "CANCELLED";

export const QUOTATION_STATUSES: QuotationStatus[] = [
  "DRAFT",
  "SENT",
  "PO_RECEIVED",
  "EXPIRED",
  "REVISED",
  "CANCELLED",
];

/** Money totals as two-decimal strings; the API computes them, never stores them. */
export interface QuotationTotals {
  currency: string;
  gstRatePercent: number;
  lineCount: number;
  subtotal: string;
  discount: string;
  taxable: string;
  gst: string;
  total: string;
}

export interface QuotationLine {
  id: string;
  itemId: string;
  quantity: number;
  rate: number;
  item: { id: string; itemCode: string; name: string; uom: string | null };
}

interface QuotationBase {
  id: string;
  ticketId: string;
  number: string;
  status: QuotationStatus;
  discountPercent: number | null;
  validUntil: string;
  notes: string | null;
  sentAt: string | null;
  poNumber: string | null;
  poDate: string | null;
  poReceivedAt: string | null;
  revisesId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuotationSummary extends QuotationBase {
  sentBy: { name: string } | null;
  lines: Array<{ quantity: number; rate: number }>;
  totals: QuotationTotals;
}

export interface QuotationDetail extends QuotationBase {
  lines: QuotationLine[];
  sentBy: { name: string } | null;
  createdBy: { name: string } | null;
  revises: { id: string; number: string } | null;
  ticket: { id: string; number: string; title: string };
  totals: QuotationTotals;
}

export interface QuotationPage {
  data: QuotationSummary[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PrintQuotation {
  company: { name: string; timezone: string; currency: string };
  ticket: {
    number: string;
    title: string;
    stage: string;
    customer: { name: string; taxId: string | null; mobile: string | null; email: string | null } | null;
    site: { title: string; line1: string | null; line2: string | null } | null;
  };
  quotation: QuotationDetail;
  generatedAt: string;
}

const post = <T>(path: string, init?: ApiRequestInit) =>
  apiFetch<T>(path, { method: "POST", ...init });

export const fetcher = <T>(key: string) => apiFetch<T>(key);

/**
 * Every quotation the viewer may see, newest first.
 * Backend: `GET /quotations?search=&status=&page=&pageSize=` returning a QuotationPage.
 */
export const listQuotations = (params: {
  search?: string;
  status?: QuotationStatus | "";
  page: number;
  pageSize: number;
}) => {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  return apiFetch<QuotationPage>(`/quotations?${query}`);
};

/** Quotations on one ticket, newest first. */
export const listForTicket = (ticketId: string) =>
  apiFetch<QuotationSummary[]>(`/quotations/ticket/${ticketId}`);

export const createQuotation = (body: {
  ticketId: string;
  validUntil: string;
  discountPercent?: number;
  notes?: string;
}) => post<QuotationDetail>("/quotations", { json: body });

export const getQuotation = (id: string) => apiFetch<QuotationDetail>(`/quotations/${id}`);

export const updateQuotation = (
  id: string,
  body: { validUntil?: string; discountPercent?: number | null; notes?: string; version: number },
) => apiFetch<QuotationDetail>(`/quotations/${id}`, { method: "PATCH", json: body });

export const deleteQuotation = (id: string) =>
  apiFetch<void>(`/quotations/${id}`, { method: "DELETE" });

export const sendQuotation = (id: string) => post<QuotationDetail>(`/quotations/${id}/send`);

export const recordPo = (id: string, body: { poNumber: string; poDate?: string; version: number }) =>
  post<QuotationDetail>(`/quotations/${id}/po`, { json: body });

/** A revision creates a NEW quotation number and returns the new draft. */
export const reviseQuotation = (id: string, version: number) =>
  post<QuotationDetail>(`/quotations/${id}/revise`, { json: { version } });

export const cancelQuotation = (id: string, version: number) =>
  post<QuotationDetail>(`/quotations/${id}/cancel`, { json: { version } });

export const addLine = (
  id: string,
  body: { itemId: string; quantity: number; rate: number },
) => post<QuotationLine>(`/quotations/${id}/lines`, { json: body });

export const updateLine = (
  id: string,
  lineId: string,
  body: { quantity: number; rate: number; version: number },
) => apiFetch<QuotationLine>(`/quotations/${id}/lines/${lineId}`, { method: "PATCH", json: body });

export const removeLine = (id: string, lineId: string) =>
  apiFetch<void>(`/quotations/${id}/lines/${lineId}`, { method: "DELETE" });

export const getPrintView = (id: string) => apiFetch<PrintQuotation>(`/quotations/${id}/print`);

interface ItemPage {
  data: Array<{ id: string; itemCode: string; name: string; uom: string | null }>;
}

export interface LineItemOption {
  id: string;
  itemCode: string;
  name: string;
  uom: string | null;
}

/** Line-item picker search, mirroring the visits spare picker. */
export const searchLineItems = async (search: string): Promise<LineItemOption[]> => {
  const params = new URLSearchParams({ page: "1", pageSize: "10" });
  if (search.trim()) params.set("search", search.trim());
  const page = await apiFetch<ItemPage>(`/items?${params}`);
  return page.data.map((i) => ({ id: i.id, itemCode: i.itemCode, name: i.name, uom: i.uom }));
};
