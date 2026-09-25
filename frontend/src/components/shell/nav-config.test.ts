import { describe, expect, it } from "vitest";
import { ALL_NAV_ITEMS, buildCrumbs, findActiveItem } from "./nav-config";

describe("findActiveItem", () => {
  it.each([
    ["/", "/"],
    ["/tickets", "/tickets"],
    ["/tickets/SB-26-000123", "/tickets"],
    ["/tickets/new", "/tickets/new"],
    ["/settings/erp", "/settings/erp"],
    ["/settings/erp/abc", "/settings/erp"],
    ["/reports/kpi", "/reports/kpi"],
  ])("%s → %s", (path, expected) => {
    expect(findActiveItem(path)?.href).toBe(expected);
  });

  it("does not treat a shared prefix as a match", () => {
    expect(findActiveItem("/ticketsx")).toBeUndefined();
  });
});

describe("buildCrumbs", () => {
  it("links parents and leaves the current page unlinked", () => {
    expect(buildCrumbs("/settings/users")).toEqual([
      { label: "Settings", href: "/settings" },
      { label: "Users & roles" },
    ]);
  });

  it("adds a detail segment after its section", () => {
    expect(buildCrumbs("/tickets/SB-26-000123")).toEqual([
      { label: "Tickets", href: "/tickets" },
      { label: "SB-26-000123" },
    ]);
  });

  it("names the home page", () => {
    expect(buildCrumbs("/")).toEqual([{ label: "Home" }]);
  });
});

describe("nav config", () => {
  it("has unique hrefs", () => {
    const hrefs = ALL_NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
