import { describe, expect, it } from "vitest";
import { ALL_NAV_ITEMS } from "./nav-config";
import { searchCommands, type Command } from "./command-search";

const commands: Command[] = ALL_NAV_ITEMS.map((item) => ({
  id: item.href,
  group: "Pages",
  label: item.label,
  hint: item.summary,
  href: item.href,
  item,
}));

const labels = (query: string) => searchCommands(commands, query).map((c) => c.label);

describe("searchCommands", () => {
  it("matches words in any order", () => {
    expect(labels("con erp")[0]).toBe("ERP connections");
  });

  it("ranks label matches above summary matches", () => {
    const result = labels("tickets");
    expect(result.indexOf("Tickets")).toBeLessThan(result.indexOf("My tickets") + 1);
    expect(result[0]).toBe("Tickets");
  });

  it("finds pages by what they do", () => {
    expect(labels("pincode")).toContain("Regions");
  });

  it("returns nothing when a word matches nowhere", () => {
    expect(labels("regions zebra")).toEqual([]);
  });

  it("returns the first entries for an empty query", () => {
    expect(searchCommands(commands, "  ", 3)).toHaveLength(3);
  });
});
