import { describe, expect, it } from "vitest";
import { safeNext } from "./next-url";

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

describe("safeNext", () => {
  it("rejects tab/newline/CR smuggled past the protocol-relative guard", () => {
    // "/<TAB>/evil.com" passes startsWith("//") checks but the browser's URL
    // parser strips the tab back to "//evil.com" on navigation.
    expect(safeNext(`/${TAB}/evil.com`)).toBe("/");
    expect(safeNext(`/${LF}/evil.com`)).toBe("/");
    expect(safeNext(`/${CR}/evil.com`)).toBe("/");
    expect(safeNext(`/tickets${TAB}`)).toBe("/");
  });

  it("still allows plain same-app paths", () => {
    expect(safeNext("/tickets")).toBe("/tickets");
    expect(safeNext("/tickets/ET-26-000001?tab=visits")).toBe("/tickets/ET-26-000001?tab=visits");
    expect(safeNext("/")).toBe("/");
  });

  it("still rejects protocol-relative, backslash and non-path values", () => {
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("")).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});
