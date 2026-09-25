import { describe, expect, it } from "vitest";
import type { TicketEvent } from "./api";
import { describeEvent, formatSpan, slaText } from "./format";

const now = new Date("2026-09-25T10:00:00Z");
const event = (patch: Partial<TicketEvent>): TicketEvent => ({
  id: "e",
  type: "NOTE",
  actor: null,
  fromStage: null,
  toStage: null,
  note: null,
  data: null,
  createdAt: now.toISOString(),
  ...patch,
});

describe("formatSpan", () => {
  it("reads naturally at each scale", () => {
    expect(formatSpan(22 * 60_000)).toBe("22m");
    expect(formatSpan(125 * 60_000)).toBe("2h 05m");
    expect(formatSpan((3 * 24 + 4) * 3_600_000)).toBe("3d 4h");
  });
});

describe("slaText", () => {
  it("shows time left, breaches, pauses and outcomes", () => {
    const due = "2026-09-25T10:22:00Z";
    expect(slaText({ clock: "response", state: "risk", dueAt: due, metAt: null }, now)).toBe(
      "22m left",
    );
    expect(
      slaText(
        { clock: "resolution", state: "breach", dueAt: "2026-09-25T09:15:00Z", metAt: null },
        now,
      ),
    ).toBe("Resolution breached 45m");
    expect(slaText({ clock: "resolution", state: "paused", dueAt: null, metAt: null }, now)).toBe(
      "Paused",
    );
    expect(
      slaText(
        {
          clock: "resolution",
          state: "breach",
          dueAt: "2026-09-25T09:00:00Z",
          metAt: "2026-09-25T10:30:00Z",
        },
        now,
      ),
    ).toBe("Missed by 1h 30m");
  });
});

describe("describeEvent", () => {
  const label = (s: string) => s.toLowerCase();

  it("words routing, assignment and stage changes", () => {
    expect(
      describeEvent(event({ type: "ROUTED", data: { regionName: "South" } }), label).what,
    ).toBe("routed the ticket to South");
    expect(describeEvent(event({ type: "ROUTED", data: { pincode: "110001" } }), label)).toEqual({
      what: "couldn't match the site to a region",
      detail: "pincode 110001",
    });
    expect(
      describeEvent(
        event({ type: "ASSIGNED", data: { engineerName: "Kiran", previousEngineerId: "x" } }),
        label,
      ).what,
    ).toBe("reassigned the ticket to Kiran");
    expect(
      describeEvent(
        event({ type: "STAGE_CHANGED", data: { action: "resume", pausedMinutes: 90 } }),
        label,
      ),
    ).toEqual({ what: "resumed work", detail: "paused 1h 30m" });
  });
});
