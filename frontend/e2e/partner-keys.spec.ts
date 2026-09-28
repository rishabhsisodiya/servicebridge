import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/** Adds extra permissions to the stub ADMIN's /auth/me (lets the 401 → refresh dance through). */
async function withExtraPermissions(page: Page, extra: string[]) {
  await page.route("**/api/v1/auth/me", async (route) => {
    const response = await route.fetch();
    let json: { permissions?: unknown };
    try {
      json = await response.json();
    } catch {
      return route.fulfill({ response });
    }
    if (!response.ok() || !Array.isArray(json.permissions)) {
      return route.fulfill({ response });
    }
    await route.fulfill({
      response,
      json: { ...json, permissions: [...(json.permissions as string[]), ...extra] },
    });
  });
}

const KEYS = [
  {
    id: "key-1",
    name: "Acme Industries",
    keyPrefix: "sbp_abc123",
    scopes: ["tickets.create", "tickets.read"],
    createdBy: { id: "u1", name: "Asha" },
    expiresAt: null,
    lastUsedAt: "2026-09-20T10:00:00.000Z",
    revokedAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
  },
  {
    id: "key-2",
    name: "Old vendor",
    keyPrefix: "sbp_def456",
    scopes: ["tickets.read"],
    createdBy: { id: "u1", name: "Asha" },
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: "2026-09-10T10:00:00.000Z",
    createdAt: "2026-08-01T10:00:00.000Z",
  },
];


test.describe("partner API keys", () => {
  test("the key list shows names, prefixes, scopes and statuses", async ({ page }) => {
    await withExtraPermissions(page, ["partner.read", "partner.edit"]);
    await page.route("**/api/v1/partner-keys", (route) =>
      route.fulfill({ status: 200, json: KEYS }),
    );

    await page.goto("/settings/partner-keys");
    await expect(page.getByRole("heading", { name: "Partner API keys", level: 1 })).toBeVisible();
    await expect(page.getByText("Acme Industries")).toBeVisible();
    await expect(page.getByText("sbp_abc123…")).toBeVisible();
    await expect(page.getByText("Active")).toBeVisible();
    await expect(page.getByText("Revoked")).toBeVisible();
    await expect(page.getByRole("button", { name: "New key" })).toBeVisible();
  });

  test("creating a key shows it exactly once and gates Done behind copying", async ({
    page,
    context,
  }) => {
    await withExtraPermissions(page, ["partner.read", "partner.edit"]);
    let gets = 0;
    await page.route("**/api/v1/partner-keys", async (route) => {
      if (route.request().method() === "GET") {
        gets += 1;
        return route.fulfill({ status: 200, json: gets > 1 ? [...KEYS, NEW_KEY_LISTED] : KEYS });
      }
      const body = await route.request().postDataJSON();
      expect(body.name).toBe("Beta Traders");
      return route.fulfill({ status: 201, json: NEW_KEY_CREATED });
    });

    await context.grantPermissions(["clipboard-write"]);
    await page.goto("/settings/partner-keys");
    await page.getByRole("button", { name: "New key" }).click();
    await page.getByLabel("Key name").fill("Beta Traders");
    await page.getByRole("button", { name: "Create key" }).click();

    // Show-once dialog with the raw key.
    await expect(page.getByRole("heading", { name: "Copy the key now" })).toBeVisible();
    await expect(page.getByText("sbp_CREATEDRAWKEY1234567890", { exact: false })).toBeVisible();
    const done = page.getByRole("button", { name: "Copy the key first" });
    await expect(done).toBeDisabled();

    await page.getByRole("button", { name: "Copy key" }).click();
    await expect(page.getByRole("button", { name: "Done" })).toBeEnabled();
    await page.getByRole("button", { name: "Done" }).click();

    // List refreshes and the new key appears (prefix only).
    await expect(page.getByText("Beta Traders")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Copy the key now" })).toHaveCount(0);
  });

  test("revoking a key asks for confirmation and updates the list", async ({ page }) => {
    await withExtraPermissions(page, ["partner.read", "partner.edit"]);
    let revoked = false;
    await page.route("**/api/v1/partner-keys", (route) =>
      route.fulfill({
        status: 200,
        json: KEYS.map((k) =>
          k.id === "key-1" && revoked ? { ...k, revokedAt: "2026-09-29T00:00:00.000Z" } : k,
        ),
      }),
    );
    await page.route("**/api/v1/partner-keys/key-1/revoke", (route) => {
      revoked = true;
      return route.fulfill({ status: 200, json: { ...KEYS[0], revokedAt: "2026-09-29T00:00:00.000Z" } });
    });

    await page.goto("/settings/partner-keys");
    await page.getByRole("row", { name: /Acme Industries/ }).getByRole("button", { name: "Revoke" }).click();
    await expect(
      page.getByRole("heading", { name: 'Revoke "Acme Industries"?' }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Revoke key" }).click();

    await expect(page.getByRole("row", { name: /Acme Industries/ }).getByText("Revoked")).toBeVisible();
  });

  test("a viewer without the permission sees no actions", async ({ page }) => {
    // No extra permissions: the stub ADMIN lacks partner.* until integrated.
    await page.route("**/api/v1/auth/me", async (route) => {
      const response = await route.fetch();
      let json: { permissions?: unknown };
      try {
        json = await response.json();
      } catch {
        return route.fulfill({ response });
      }
      if (!response.ok() || !Array.isArray(json.permissions)) {
        return route.fulfill({ response });
      }
      await route.fulfill({
        response,
        json: {
          ...json,
          permissions: (json.permissions as string[]).filter(
            (p: string) => !p.startsWith("partner."),
          ),
        },
      });
    });
    await page.goto("/settings/partner-keys");
    await expect(page.getByRole("button", { name: "New key" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  });
});

const NEW_KEY_CREATED = {
  id: "key-3",
  name: "Beta Traders",
  keyPrefix: "sbp_new789",
  scopes: ["tickets.create", "tickets.read"],
  createdBy: { id: "u1", name: "Asha" },
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-09-29T00:00:00.000Z",
  key: "sbp_CREATEDRAWKEY1234567890",
};

const NEW_KEY_LISTED = { ...NEW_KEY_CREATED };
delete (NEW_KEY_LISTED as { key?: string }).key;
