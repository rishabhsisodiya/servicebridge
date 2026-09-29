import { describe, expect, it } from "vitest";
import { isQuotationActionable, type PortalQuotation } from "./types";

const base: PortalQuotation = {
  id: "q-1",
  number: "Q-26-0001",
  status: "SENT",
  validUntil: null,
  approvedByCustomerAt: null,
  lines: [{ quantity: 1, rate: 100 }],
};

describe("isQuotationActionable", () => {
  it("is actionable while awaiting a customer decision", () => {
    expect(isQuotationActionable(base)).toBe(true);
    expect(isQuotationActionable({ ...base, status: "PENDING" })).toBe(true);
  });

  it("is not actionable once decided or lapsed", () => {
    for (const status of ["APPROVED", "REJECTED", "EXPIRED", "CANCELLED", "DRAFT"]) {
      expect(isQuotationActionable({ ...base, status })).toBe(false);
    }
    expect(
      isQuotationActionable({ ...base, approvedByCustomerAt: "2026-09-20T00:00:00.000Z" }),
    ).toBe(false);
  });

  it("ignores status casing", () => {
    expect(isQuotationActionable({ ...base, status: "sent" })).toBe(true);
    expect(isQuotationActionable({ ...base, status: "approved" })).toBe(false);
  });
});
