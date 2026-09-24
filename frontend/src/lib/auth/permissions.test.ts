import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The web app keeps a copy of the permission names for menus. This test fails
 * if the copy drifts from the backend's list, which is the source of truth.
 */
describe("permission names", () => {
  const extract = (source: string, start: RegExp, end: string) => {
    const from = source.search(start);
    const block = source.slice(from, source.indexOf(end, from));
    return [...block.matchAll(/["']([a-z]+\.[A-Za-z.]+)["']/g)].map((m) => m[1]).sort();
  };

  it("match backend/src/auth/permissions.ts", () => {
    const root = join(__dirname, "../../../..");
    const backend = readFileSync(join(root, "backend/src/auth/permissions.ts"), "utf8");
    const frontend = readFileSync(join(root, "frontend/src/lib/auth/session.tsx"), "utf8");
    const backendNames = extract(backend, /export const PERMISSIONS = \[/, "] as const");
    const frontendNames = extract(frontend, /export type Permission =/, ";");
    expect(backendNames.length).toBeGreaterThan(10);
    expect(frontendNames).toEqual(backendNames);
  });
});
