import useSWR from "swr";
import { apiFetch, ApiError, type ApiOptions } from "@/lib/api/client";
import type {
  PortalAmcDetail,
  PortalAmcPage,
  PortalQuotationPage,
  PortalTicketDetail,
  PortalTicketPage,
} from "./types";

/**
 * Portal API calls never trigger the staff sign-in redirect: a 401 here means
 * the magic-link session ended, and the session provider sends the visitor
 * back to /portal/login instead.
 */
export function portalFetch<T>(path: string, init: ApiOptions = {}): Promise<T> {
  return apiFetch<T>(path, { noAuthRedirect: true, ...init });
}

const TICKETS_PAGE_SIZE = 20;

export const portalKeys = {
  me: "/portal/me",
  tickets: (page: number) =>
    `/portal/tickets?page=${page}&pageSize=${TICKETS_PAGE_SIZE}`,
  ticket: (number: string) => `/portal/tickets/${encodeURIComponent(number)}`,
  quotations: (ticketNumber: string) =>
    `/portal/quotations?ticketNumber=${encodeURIComponent(ticketNumber)}`,
  amc: "/portal/amc",
  amcDetail: (id: string) => `/portal/amc/${encodeURIComponent(id)}`,
};

export function usePortalTicketList(page: number) {
  return useSWR<PortalTicketPage, ApiError>(
    portalKeys.tickets(page),
    (key: string) => portalFetch<PortalTicketPage>(key),
    { keepPreviousData: true },
  );
}

export function usePortalTicket(number: string) {
  return useSWR<PortalTicketDetail, ApiError>(
    number ? portalKeys.ticket(number) : null,
    (key: string) => portalFetch<PortalTicketDetail>(key),
  );
}

export function usePortalQuotations(ticketNumber: string) {
  return useSWR<PortalQuotationPage, ApiError>(
    ticketNumber ? portalKeys.quotations(ticketNumber) : null,
    (key: string) => portalFetch<PortalQuotationPage>(key),
  );
}

export async function approveQuotation(
  id: string,
  poNumber?: string,
): Promise<{ ok: boolean; status: string }> {
  return portalFetch<{ ok: boolean; status: string }>(
    `/portal/quotations/${encodeURIComponent(id)}/approve`,
    { method: "POST", json: poNumber?.trim() ? { poNumber: poNumber.trim() } : {} },
  );
}

export async function rejectQuotation(id: string, reason?: string): Promise<{ ok: boolean }> {
  return portalFetch<{ ok: boolean }>(
    `/portal/quotations/${encodeURIComponent(id)}/reject`,
    { method: "POST", json: reason?.trim() ? { reason: reason.trim() } : {} },
  );
}

export function usePortalAmcList() {
  return useSWR<PortalAmcPage, ApiError>(portalKeys.amc, (key: string) =>
    portalFetch<PortalAmcPage>(key),
  );
}

export function usePortalAmc(id: string) {
  return useSWR<PortalAmcDetail, ApiError>(
    id ? portalKeys.amcDetail(id) : null,
    (key: string) => portalFetch<PortalAmcDetail>(key),
  );
}
