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

const PREVIEW = {
  validationId: "val-1",
  entity: "customers",
  columns: ["name", "customer_group", "territory", "tax_id", "mobile", "email"],
  rows: [
    {
      index: 1,
      data: {
        name: "New Customer Co",
        customer_group: "Retail",
        territory: "East",
        tax_id: "",
        mobile: "9111111111",
        email: "hello@newco.example",
      },
      status: "valid",
      errors: [],
      note: null,
      defaultMode: "create",
      matchedExisting: null,
    },
    {
      index: 2,
      data: {
        name: "Acme Industries",
        customer_group: "",
        territory: "",
        tax_id: "",
        mobile: "9222222222",
        email: "",
      },
      status: "warning",
      errors: [],
      note: 'Matches existing customer "Acme Industries" — updates fill blanks only.',
      defaultMode: "update-fill",
      matchedExisting: { id: "c1", name: "Acme Industries" },
    },
    {
      index: 3,
      data: { name: "", customer_group: "", territory: "", tax_id: "", mobile: "", email: "" },
      status: "error",
      errors: ["Row 3: name is required."],
      note: null,
      defaultMode: "skip",
      matchedExisting: null,
    },
  ],
  summary: { valid: 1, warning: 1, error: 1 },
  expiresAt: "2026-09-29T01:30:00.000Z",
};

test.describe("bulk import", () => {
  test("validating a CSV shows a row-by-row preview with per-row actions", async ({ page }) => {
    await withExtraPermissions(page, ["imports.edit"]);
    await page.route("**/api/v1/imports/customers/validate", (route) =>
      route.fulfill({ status: 200, json: PREVIEW }),
    );
    await page.route("**/api/v1/imports/customers/confirm", (route) =>
      route.fulfill({ status: 200, json: { created: 1, updated: 1, skipped: 1, errors: [] } }),
    );

    await page.goto("/settings/import");
    await expect(page.getByRole("heading", { name: "Bulk import", level: 1 })).toBeVisible();

    // Upload a file through the hidden input.
    const buffer = Buffer.from(
      "name,customer_group,territory,tax_id,mobile,email\nNew Customer Co,Retail,East,,9111111111,hello@newco.example\n",
    );
    await page.locator('input[type="file"][aria-label="CSV file to import"]').setInputFiles({
      name: "customers.csv",
      mimeType: "text/csv",
      buffer,
    });

    await expect(page.getByText("New Customer Co")).toBeVisible();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    await expect(page.getByText("Matched", { exact: true })).toBeVisible();
    await expect(page.getByText("Row 3: name is required.")).toBeVisible();

    // Per-row action select for the matched row.
    const actionSelect = page.getByLabel("Action for row 2");
    await expect(actionSelect).toHaveValue("update-fill");
    await actionSelect.selectOption("update-overwrite");
    await expect(actionSelect).toHaveValue("update-overwrite");

    // Error rows cannot change their action.
    await expect(page.getByLabel("Action for row 3")).toBeDisabled();

    // Confirm writes the report.
    await page.getByRole("button", { name: "Confirm import" }).click();
    await expect(page.getByText("1 created", { exact: true })).toBeVisible();
    await expect(page.getByText("1 updated", { exact: true })).toBeVisible();
  });

  test("switching entity changes the template columns", async ({ page }) => {
    await withExtraPermissions(page, ["imports.edit"]);
    await page.goto("/settings/import");
    await page.getByRole("radio", { name: "Machines" }).click();
    await expect(
      page.getByText("customer_name must already exist — import customers first."),
    ).toBeVisible();
  });
});
