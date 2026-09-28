import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const BUILT_PAGES = [
  "/",
  "/tickets",
  "/tickets/SB-26-000415",
  "/tickets/new",
  "/my-tickets",
  "/settings",
  "/settings/design-system",
  "/settings/users",
  "/settings/roles",
  "/settings/erp",
  "/account",
  "/customers",
  "/settings/service-rules",
];

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join(" | ")}`,
  );
  expect(summary, "accessibility violations").toEqual([]);
}

test.describe("navigation", () => {
  test("sidebar marks the current page and breadcrumbs follow", async ({ page }) => {
    await page.goto("/tickets");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Tickets", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.getByRole("link", { name: "SB-26-000415" }).click();
    await expect(page).toHaveURL(/\/tickets\/SB-26-000415$/);
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Tickets" })).toBeVisible();
    await expect(crumbs.getByText("SB-26-000415")).toHaveAttribute("aria-current", "page");
    // Focus moves to the new page's heading after client navigation.
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  });

  test("planned screens explain when they arrive", async ({ page }) => {
    await page.goto("/settings/audit-log");
    await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
    await expect(page.getByText(/build session 15/)).toBeVisible();
  });

  test("unknown addresses show the not-found page", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("We couldn't find that page")).toBeVisible();
  });
});

test.describe("search", () => {
  test("Ctrl+K opens search and Enter goes to the highlighted result", async ({ page }) => {
    await page.goto("/");
    // Rendered only after hydration, so the shortcut listener is attached by now.
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const box = page.getByRole("combobox", { name: "Search screens and actions" });
    await expect(box).toBeFocused();
    await box.fill("pincode");
    await expect(page.getByRole("listbox").getByRole("option").first()).toContainText("Regions");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings\/regions$/);
  });

  test("Escape closes search", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Search/ }).click();
    const box = page.getByRole("combobox", { name: "Search screens and actions" });
    await expect(box).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(box).toBeHidden();
  });
});

test.describe("theme", () => {
  test("the chosen theme survives a reload without a flash", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    const toggle = page.getByRole("button", { name: /^Theme:/ });
    await toggle.click(); // system → light
    await toggle.click(); // light → dark
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Read the attribute as soon as the DOM exists, before hydration could change it.
    await page.reload({ waitUntil: "commit" });
    await page.waitForFunction(() =>
      document.documentElement.hasAttribute("data-theme-preference"),
    );
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  });

  test("system preference is followed by default", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "system");
  });
});

test.describe("ticket actions", () => {
  test("resolving validates, confirms and announces the result", async ({ page }) => {
    await page.goto("/tickets/SB-26-000415");
    await page.getByRole("button", { name: "Mark resolved" }).click();
    const dialog = page.getByRole("dialog", { name: "Mark this ticket resolved?" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/What was done/).fill("short");
    await dialog.getByRole("button", { name: "Mark resolved" }).click();
    await expect(dialog.getByText(/at least 10 characters/)).toBeVisible();

    await dialog
      .getByLabel(/What was done/)
      .fill("Replaced the mantle liner and reset the setting.");
    await dialog.getByRole("button", { name: "Mark resolved" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "Marked resolved" })).toBeVisible();
  });

  test("Escape closes a dialog and returns focus to its button", async ({ page }) => {
    await page.goto("/tickets/SB-26-000415");
    const opener = page.getByRole("button", { name: "Put on hold" });
    await opener.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test("the menu opens as a drawer, traps the page and closes with Escape", async ({ page }) => {
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Open navigation" });
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    await expect(page.locator("#app-nav a").first()).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
  });

  test("pages never scroll sideways", async ({ page }) => {
    for (const path of BUILT_PAGES) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(0);
    }
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`accessibility (${scheme})`, () => {
    for (const path of BUILT_PAGES) {
      test(`${path} has no WCAG AA violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoA11yViolations(page);
      });
    }
  });
}
