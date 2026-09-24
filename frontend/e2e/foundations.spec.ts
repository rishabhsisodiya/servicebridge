import { expect, test } from "./fixtures";

test("design-system page reports API status through the proxy", async ({ page }) => {
  await page.goto("/settings/design-system");
  await expect(page.getByRole("heading", { name: "Design system", level: 1 })).toBeVisible();
  await expect(page.getByLabel("API status")).toContainText("Database");
  await expect(page.getByText("Up · 4 ms")).toBeVisible();
});

test("proxy forwards path, query string and cookies to the API", async ({ request }) => {
  const res = await request.get("/api/v1/echo/tickets?page=2", {
    headers: { cookie: "sb_refresh=abc" },
  });
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({
    path: "/api/v1/echo/tickets?page=2",
    cookie: "sb_refresh=abc",
  });
});

test("non-API routes are not proxied", async ({ request }) => {
  // The request client doesn't share the browser's cookies, so send the sign-in marker.
  const res = await request.get("/does-not-exist", { headers: { cookie: "sb_signed_in=1" } });
  expect(res.status()).toBe(404);
  expect(res.headers()["content-type"]).toContain("text/html");
});
