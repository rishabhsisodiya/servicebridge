import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeNext } from "@/lib/auth/next-url";
import { isPublicPage, proxy } from "./proxy";

const req = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie ? { cookie } : {},
  });

afterEach(() => vi.unstubAllEnvs());

describe("proxy page protection", () => {
  it("sends signed-out visitors to sign in, remembering where they were going", () => {
    const res = proxy(req("/tickets/SB-26-000415?tab=activity"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/tickets/SB-26-000415?tab=activity");
  });

  it("lets signed-in visitors through", () => {
    expect(proxy(req("/tickets", "sb_signed_in=1")).headers.get("x-middleware-next")).toBe("1");
  });

  it("always shows the sign-in page, even with a stale sign-in marker", () => {
    expect(
      proxy(req("/login?next=/settings", "sb_signed_in=1")).headers.get("x-middleware-next"),
    ).toBe("1");
  });

  it("keeps invite and reset links public", () => {
    expect(isPublicPage("/welcome/abc")).toBe(true);
    expect(isPublicPage("/reset-password/abc")).toBe(true);
    expect(isPublicPage("/welcome")).toBe(false);
    expect(isPublicPage("/settings")).toBe(false);
  });

  it("still forwards the API", () => {
    vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:4000");
    const res = proxy(req("/api/v1/auth/me"));
    expect(res.headers.get("x-middleware-rewrite")).toBe("http://127.0.0.1:4000/api/v1/auth/me");
  });
});

describe("safeNext", () => {
  it.each([
    ["/tickets?x=1", "/tickets?x=1"],
    [null, "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
  ])("%p → %p", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
