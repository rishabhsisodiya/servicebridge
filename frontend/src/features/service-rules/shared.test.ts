import { describe, expect, it } from "vitest";
import { formatMinutes, joinMinutes, splitMinutes } from "./shared";

describe("SLA durations", () => {
  it("formats minutes for people", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(240)).toBe("4 h");
    expect(formatMinutes(1440 * 2 + 360)).toBe("2 d 6 h");
  });

  it("round-trips through the largest exact unit", () => {
    expect(splitMinutes(2880)).toEqual({ value: "2", unit: "d" });
    expect(splitMinutes(90)).toEqual({ value: "90", unit: "min" });
    expect(splitMinutes(480)).toEqual({ value: "8", unit: "h" });
    expect(joinMinutes("1.5", "h")).toBe(90);
    expect(joinMinutes("", "h")).toBe(0);
    expect(joinMinutes("abc", "d")).toBeNaN();
  });
});
