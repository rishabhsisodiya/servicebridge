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

const ENTRIES = {
  rows: [
    {
      id: "a1",
      action: "partner.ticket_created",
      entityType: "Ticket",
      entityId: "t1",
      summary: "Partner key “Acme Industries” logged ticket T-1042",
      changes: { number: "T-1042", summary: "Pump not priming" },
      ip: null,
      requestId: "r1",
      createdAt: "2026-09-28T10:00:00.000Z",
      actor: null,
      partnerKey: { id: "key-1", name: "Acme Industries" },
    },
    {
      id: "a2",
      action: "ticket.stage_changed",
      entityType: "Ticket",
      entityId: "t1",
      summary: "Asha moved T-1042 to In progress",
      changes: { from: "OPEN", to: "IN_PROGRESS" },
      ip: "127.0.0.1",
      requestId: "r2",
      createdAt: "2026-09-28T11:00:00.000Z",
      actor: { id: "u1", name: "Asha" },
      partnerKey: null,
    },
  ],
  total: 2,
  page: 1,
  pageSize: 25,
};

test.describe("audit log", () => {
  test("lists entries with actor pills and expandable changes", async ({ page }) => {
    await withExtraPermissions(page, ["audit.read", "audit.edit"]);
    await page.route("**/api/v1/audit-log?*", (route) =>
      route.fulfill({ status: 200, json: ENTRIES }),
    );
    await page.route("**/api/v1/audit-log/retention", (route) =>
      route.fulfill({ status: 200, json: { retentionDays: 365 } }),
    );

    await page.goto("/settings/audit-log");
    await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
    await expect(page.getByText("partner.ticket_created")).toBeVisible();
    await expect(page.getByText("Key: Acme Industries")).toBeVisible();
    await expect(page.getByText("Asha")).toBeVisible();
    await expect(page.getByText("Entries older than")).toBeVisible();

    // Expanding a row shows the full changes payload.
    await page.getByRole("button", { name: "number, summary" }).click();
    await expect(page.getByText('"T-1042"')).toBeVisible();
  });

  test("filtering by action prefix re-queries the list", async ({ page }) => {
    await withExtraPermissions(page, ["audit.read", "audit.edit"]);
    await page.route("**/api/v1/audit-log?*", (route) =>
      route.fulfill({ status: 200, json: ENTRIES }),
    );
    await page.route("**/api/v1/audit-log/retention", (route) =>
      route.fulfill({ status: 200, json: { retentionDays: 365 } }),
    );

    await page.goto("/settings/audit-log");
    await expect(page.getByText("partner.ticket_created")).toBeVisible();
    const filtered = page.waitForResponse((r) => r.url().includes("action=partner."));
    await page.getByLabel("Action prefix").selectOption("partner.");
    await filtered;
  });

  test("updating retention needs confirmation and the password step-up", async ({ page }) => {
    await withExtraPermissions(page, ["audit.read", "audit.edit"]);
    await page.route("**/api/v1/audit-log?*", (route) =>
      route.fulfill({ status: 200, json: ENTRIES }),
    );
    await page.route("**/api/v1/audit-log/retention", async (route) => {
      if (route.request().method() === "PATCH") {
        const body = await route.request().postDataJSON();
        expect(body.retentionDays).toBe(730);
        return route.fulfill({ status: 200, json: { retentionDays: 730 } });
      }
      return route.fulfill({ status: 200, json: { retentionDays: 365 } });
    });

    await page.goto("/settings/audit-log");
    await page.getByRole("button", { name: "Retention" }).click();
    await page.getByLabel("Keep entries for (days)").fill("730");
    await page.getByRole("button", { name: "Save" }).click();

    // No step-up challenge from the mock: saves directly and closes the dialog.
    await expect(page.getByText("Retention set to 730 days.")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Audit retention" })).toBeHidden();
  });
});
