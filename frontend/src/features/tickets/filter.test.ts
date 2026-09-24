import { describe, expect, it } from "vitest";
import { MOCK_TICKETS } from "@/mocks/tickets";
import { countQuick, filterTickets } from "./filter";

const numbers = (text: string, quick: Parameters<typeof filterTickets>[1]["quick"] = "open") =>
  filterTickets(MOCK_TICKETS, { text, quick }).map((t) => t.number);

describe("filterTickets", () => {
  it("excludes closed tickets from the open view", () => {
    expect(numbers("")).not.toContain("SB-26-000379");
    expect(numbers("", "closed")).toEqual(["SB-26-000379"]);
  });

  it("matches any word across customer, serial and engineer", () => {
    expect(numbers("kaveri arjun")).toEqual(["SB-26-000402", "SB-26-000411"]);
    expect(numbers("CX400-2311")).toEqual(["SB-26-000415"]);
  });

  it("finds unassigned open tickets", () => {
    expect(numbers("", "unassigned")).toEqual(["SB-26-000418", "SB-26-000388"]);
  });

  it("sorts by priority when asked", () => {
    const sorted = filterTickets(MOCK_TICKETS, {
      text: "",
      quick: "open",
      sortByPriority: "ascending",
    });
    expect(sorted[0].priority).toBe("CRITICAL");
    expect(sorted[sorted.length - 1].priority).toBe("LOW");
  });

  it("counts each quick filter", () => {
    expect(countQuick(MOCK_TICKETS, "sla-risk")).toBe(3);
  });
});
