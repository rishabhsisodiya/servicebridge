import { describe, expect, it } from "vitest";
import { actorTone, summarizeChanges } from "./audit-log-screen";

describe("actorTone", () => {
  it("labels a missing actor as System", () => {
    expect(actorTone(null)).toEqual({ label: "System", tone: "neutral" });
  });

  it("labels a partner key actor with its key name", () => {
    expect(actorTone({ type: "partner-key", name: "Acme" }).label).toBe("Key: Acme");
  });

  it("labels a user actor by name", () => {
    expect(actorTone({ type: "user", name: "Asha" }).label).toBe("Asha");
  });
});

describe("summarizeChanges", () => {
  it("renders null and empty objects as an em dash", () => {
    expect(summarizeChanges(null)).toBe("—");
    expect(summarizeChanges({})).toBe("—");
  });

  it("lists the changed field names", () => {
    expect(summarizeChanges({ stage: ["OPEN", "IN_PROGRESS"], priority: ["P3", "P1"] })).toBe(
      "stage, priority",
    );
  });

  it("truncates long change lists", () => {
    expect(summarizeChanges({ a: 1, b: 2, c: 3, d: 4, e: 5 })).toBe("a, b, c, d (+1 more)");
  });

  it("passes strings through", () => {
    expect(summarizeChanges("ticket closed")).toBe("ticket closed");
  });
});
