import { describe, expect, it } from "vitest";
import { keyStatus, PARTNER_SCOPES, type PartnerKey } from "./partner-keys";

const base: PartnerKey = {
  id: "k1",
  name: "Acme",
  keyPrefix: "sbp_abc",
  scopes: ["tickets.create"],
  createdBy: null,
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("keyStatus", () => {
  it("marks a fresh key as active", () => {
    expect(keyStatus(base)).toEqual({ label: "Active", tone: "ok" });
  });

  it("marks a revoked key as revoked", () => {
    expect(keyStatus({ ...base, revokedAt: "2026-02-01T00:00:00.000Z" }).label).toBe("Revoked");
  });

  it("marks a past-expiry key as expired", () => {
    expect(keyStatus({ ...base, expiresAt: "2020-01-01T00:00:00.000Z" }).label).toBe("Expired");
  });

  it("keeps a future-expiry key active", () => {
    expect(keyStatus({ ...base, expiresAt: "2099-01-01T00:00:00.000Z" }).label).toBe("Active");
  });
});

describe("PARTNER_SCOPES", () => {
  it("offers only ticket scopes (partners see tickets only)", () => {
    const values = PARTNER_SCOPES.map((s) => s.value);
    expect(values).toEqual(["tickets.create", "tickets.read"]);
    for (const scope of PARTNER_SCOPES) {
      expect(scope.label).toMatch(/\S/);
      expect(scope.help).toMatch(/\S/);
    }
  });
});
