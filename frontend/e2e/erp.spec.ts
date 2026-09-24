import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function addConnection(page: Page, apiKey: string) {
  await page.getByRole("button", { name: "Add connection" }).first().click();
  const drawer = page.getByRole("dialog", { name: "Add an ERP connection" });
  await drawer.getByLabel("Name").fill("Head office ERPNext");
  await drawer.getByLabel("ERPNext address").fill("https://erp.example.com/");
  await drawer.getByLabel("API key").fill(apiKey);
  await drawer.getByLabel("API secret").fill("secret12345");
  return drawer;
}

async function confirmPassword(page: Page) {
  const confirm = page.getByRole("dialog", { name: "Confirm it's you" });
  await confirm.getByLabel("Your password").fill("admin-password-1");
  await confirm.getByRole("button", { name: "Confirm" }).click();
}

test.describe("ERP connections", () => {
  test("starts empty and explains what's needed", async ({ page }) => {
    await page.goto("/settings/erp");
    await expect(page.getByText("No ERP connected yet")).toBeVisible();
  });

  test("test before saving shows what the API user can read", async ({ page }) => {
    await page.goto("/settings/erp");
    const drawer = await addConnection(page, "goodkey123");
    await drawer.getByRole("button", { name: "Test before saving" }).click();
    const result = drawer.getByLabel("Connection test result");
    await expect(result.getByRole("status")).toContainText("Connection works");
    await expect(result).toContainText("sb-integration@example.com");
    await expect(result).toContainText("ERPNext 15.37.0");
    // Item Price is not readable, so master data sync is flagged with the fix.
    await expect(result).toContainText("The API user can't read: Item Price");
  });

  test("a rejected key is explained in the test result", async ({ page }) => {
    await page.goto("/settings/erp");
    const drawer = await addConnection(page, "wrongkey99");
    await drawer.getByRole("button", { name: "Test before saving" }).click();
    await expect(drawer.getByLabel("Connection test result")).toContainText(
      "The API key or secret was rejected",
    );
  });

  test("save (with password check), test, enable, then use it for dashboards", async ({ page }) => {
    await page.goto("/settings/erp");
    const drawer = await addConnection(page, "goodkey123");
    await drawer.getByRole("button", { name: "Save connection" }).click();
    await confirmPassword(page);

    const card = page.getByRole("region", { name: "Head office ERPNext" });
    await expect(card.getByText("Needs a test")).toBeVisible();
    await expect(card).toContainText("API key ••••y123");

    await card.getByRole("button", { name: "Test" }).click();
    await expect(card.getByLabel("Connection test result")).toContainText("Connection works");
    await card.getByRole("button", { name: "Enable" }).click();
    await expect(card.getByText("Active", { exact: true })).toBeVisible();

    const purposes = page.getByRole("region", { name: "What each connection is used for" });
    await purposes.getByLabel("Business dashboards").selectOption({ label: "Head office ERPNext" });
    await purposes.getByRole("button", { name: "Save" }).click();
    await expect(card.getByText("Business dashboards")).toBeVisible();
  });

  test("a connection in use can't be deleted", async ({ page }) => {
    await page.goto("/settings/erp");
    const drawer = await addConnection(page, "goodkey123");
    await drawer.getByRole("button", { name: "Save connection" }).click();
    await confirmPassword(page);
    const card = page.getByRole("region", { name: "Head office ERPNext" });
    await card.getByRole("button", { name: "Test" }).click();
    await card.getByRole("button", { name: "Enable" }).click();
    const purposes = page.getByRole("region", { name: "What each connection is used for" });
    await purposes.getByLabel("Business dashboards").selectOption({ label: "Head office ERPNext" });
    await purposes.getByRole("button", { name: "Save" }).click();
    await expect(card.getByText("Business dashboards")).toBeVisible();

    await card.getByRole("button", { name: "More actions for Head office ERPNext" }).click();
    await page.getByRole("button", { name: "Delete…" }).click();
    await page
      .getByRole("dialog", { name: /Delete/ })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Choose another connection" }),
    ).toBeVisible();
  });

  test("the address must be https", async ({ page }) => {
    await page.goto("/settings/erp");
    const drawer = await addConnection(page, "goodkey123");
    await drawer.getByLabel("ERPNext address").fill("http://erp.example.com");
    await drawer.getByRole("button", { name: "Save connection" }).click();
    await confirmPassword(page);
    await expect(drawer.getByText("Use an https:// address.")).toBeVisible();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`has no WCAG AA violations (${scheme}, with a test result open)`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.goto("/settings/erp");
      const drawer = await addConnection(page, "goodkey123");
      await drawer.getByRole("button", { name: "Test before saving" }).click();
      await expect(drawer.getByLabel("Connection test result")).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
    });
  }
});
