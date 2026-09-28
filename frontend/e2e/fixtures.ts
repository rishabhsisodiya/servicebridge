import { test as base, type BrowserContext } from "@playwright/test";

export type StubRole = "ADMIN" | "ENGINEER" | "VIEWER";

/** Signs the browser in against the stub API (cookies only; no form). */
export async function signIn(context: BrowserContext, baseURL: string, role: StubRole = "ADMIN") {
  const url = new URL(baseURL);
  await context.addCookies([
    { name: "sb_signed_in", value: "1", domain: url.hostname, path: "/" },
    { name: "stub_role", value: role, domain: url.hostname, path: "/" },
    // Isolates stub state (password confirmations, ERP connections) between tests.
    { name: "stub_session", value: crypto.randomUUID(), domain: url.hostname, path: "/" },
  ]);
}

/** `test` with the browser already signed in as an administrator. */
export const test = base.extend({
  context: async ({ context, baseURL }, provide) => {
    await signIn(context, baseURL!);
    await provide(context);
  },
});

export { expect } from "@playwright/test";
