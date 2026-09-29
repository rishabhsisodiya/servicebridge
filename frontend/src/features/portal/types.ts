/**
 * Customer portal API types. Mirrors the `GET /portal/*` contract exactly; the
 * portal backend hides money values, so amounts never appear here.
 */

export interface PortalContact {
  id: string;
  fullName: string;
  email: string;
}

export interface PortalCustomer {
  id: string;
  name: string;
}

export interface PortalMe {
  contact: PortalContact;
  customer: PortalCustomer;
}

export interface PortalTicketItem {
  number: string;
  title: string;
  stage: string;
  priority: string;
  slaDueAt: string | null;
  createdAt: string;
}

export interface PortalTicketPage {
  items: PortalTicketItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PortalTimelineEvent {
  type: string;
  at: string;
  summary: string;
}

export interface PortalAttachment {
  id: string;
  filename: string;
}

export type CsatState = "none" | "pending" | "answered";

export interface PortalTicketDetail {
  number: string;
  title: string;
  description: string;
  stage: string;
  priority: string;
  slaDueAt: string | null;
  createdAt: string;
  equipment: { id: string; name: string } | null;
  timeline: PortalTimelineEvent[];
  attachments: PortalAttachment[];
  csat: { state: CsatState };
}

export interface PortalQuotationLine {
  quantity: number;
  rate: number;
}

export interface PortalQuotation {
  id: string;
  number: string;
  status: string;
  validUntil: string | null;
  approvedByCustomerAt: string | null;
  lines: PortalQuotationLine[];
}

export interface PortalQuotationPage {
  items: PortalQuotation[];
}

/** A quotation is actionable while the customer hasn't decided and it hasn't lapsed. */
export function isQuotationActionable(quotation: PortalQuotation): boolean {
  if (quotation.approvedByCustomerAt) return false;
  return !["APPROVED", "REJECTED", "EXPIRED", "CANCELLED", "DRAFT"].includes(
    quotation.status.toUpperCase(),
  );
}

export interface PortalAmcItem {
  id: string;
  number: string;
  status: string;
  startsOn: string;
  endsOn: string;
  equipmentCount: number;
}

export interface PortalAmcPage {
  items: PortalAmcItem[];
}

/**
 * The contract doesn't spell out the planned-visit shape, so every field is
 * optional except the id and rendering stays defensive.
 */
export interface PortalPlannedVisit {
  id: string;
  scheduledOn?: string | null;
  status?: string;
  summary?: string;
}

export interface PortalAmcDetail {
  id: string;
  number: string;
  status: string;
  startsOn: string;
  endsOn: string;
  equipment: { id: string; name: string }[];
  plannedVisits: PortalPlannedVisit[];
}
