import { describe, expect, it } from "vitest";
import type { Catalog } from "./api";
import { accessSummary, toggle } from "./grid";

const catalog: Catalog = {
  records: [
    { key: "tickets", label: "Tickets", ops: ["read", "create", "edit"] },
    { key: "customers", label: "Customers", ops: ["read"] },
    { key: "users", label: "Users", ops: ["read", "create", "edit", "delete"] },
    { key: "audit", label: "Audit log", ops: ["read"] },
  ],
  actions: [
    { key: "tickets.assign", label: "Assign tickets", hint: "" },
    { key: "demo.manage", label: "Manage demo data", hint: "" },
  ],
  scopes: [],
};

const sorted = (set: Set<string>) => [...set].sort();

describe("permission grid", () => {
  it("turns on read with any other permission on the record", () => {
    expect(sorted(toggle(new Set(), "users.edit", catalog))).toEqual(["users.edit", "users.read"]);
  });

  it("turns on the record's read with a workflow action", () => {
    expect(sorted(toggle(new Set(), "tickets.assign", catalog))).toEqual([
      "tickets.assign",
      "tickets.read",
    ]);
  });

  it("adds nothing extra for actions whose record has no read", () => {
    expect(sorted(toggle(new Set(), "demo.manage", catalog))).toEqual(["demo.manage"]);
  });

  it("turning read off clears the rest of the record, including its actions", () => {
    const start = new Set(["tickets.read", "tickets.edit", "tickets.assign", "users.read"]);
    expect(sorted(toggle(start, "tickets.read", catalog))).toEqual(["users.read"]);
  });

  it("turning another permission off leaves read alone", () => {
    const start = new Set(["users.read", "users.edit"]);
    expect(sorted(toggle(start, "users.edit", catalog))).toEqual(["users.read"]);
  });

  it("keeps permissions the grid doesn't show (planned screens)", () => {
    const start = new Set(["amc.read", "users.read"]);
    expect(sorted(toggle(start, "users.read", catalog))).toEqual(["amc.read"]);
  });

  it("summarises readable records", () => {
    expect(accessSummary([], catalog)).toBe("No records");
    expect(
      accessSummary(["tickets.read", "customers.read", "users.read", "audit.read"], catalog),
    ).toBe("Tickets, Customers, Users +1");
  });
});
