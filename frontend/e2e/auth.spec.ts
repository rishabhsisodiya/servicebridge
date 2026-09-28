import AxeBuilder from "@axe-core/playwright";
import { test as plain, expect } from "@playwright/test";
import { signIn, test } from "./fixtures";

plain.describe("signing in", () => {
  plain("a signed-out visitor is sent to sign in and returned afterwards", async ({ page }) => {
    await page.goto("/tickets?tab=open");
    await expect(page).toHaveURL(/\/login\?next=%2Ftickets%3Ftab%3Dopen$/);

    await page.getByLabel("Work email").fill("admin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("admin-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/tickets\?tab=open$/);
    await expect(page.getByRole("heading", { name: "Tickets", level: 1 })).toBeVisible();
  });

  plain("a wrong password shows one clear message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("admin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Scoped to the form: Next's route announcer also has role="alert".
    const alert = page.locator("form").getByRole("alert");
    await expect(alert).toHaveText("Email or password is incorrect.");
    await expect(alert).toBeFocused();
  });

  plain("empty fields are flagged next to the field", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter your work email.")).toBeVisible();
    await expect(page.getByLabel("Work email")).toHaveAttribute("aria-invalid", "true");
  });

  plain("the password can be shown and hidden", async ({ page }) => {
    await page.goto("/login");
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
  });

  plain(
    "an expired access token is refreshed without the user noticing",
    async ({ page, context, baseURL }) => {
      await signIn(context, baseURL!);
      await context.addCookies([
        { name: "stub_expire_once", value: "1", domain: "127.0.0.1", path: "/" },
      ]);
      await page.goto("/account");
      await expect(page.getByLabel("Email")).toHaveValue("admin@example.com");
    },
  );
});

plain.describe("stale sessions", () => {
  plain("an expired access cookie is refreshed silently", async ({ page, context, baseURL }) => {
    // Signed-in marker and refresh still valid, but the 15-minute access cookie is gone.
    await signIn(context, baseURL!);
    await page.goto("/account");
    await expect(page.getByLabel("Email")).toHaveValue("admin@example.com");
  });

  plain(
    "an ended session lands on sign-in once, without a redirect loop",
    async ({ page, context, baseURL }) => {
      await signIn(context, baseURL!);
      await context.addCookies([
        { name: "stub_refresh_fails", value: "1", domain: new URL(baseURL!).hostname, path: "/" },
      ]);
      // Full document loads only: Next's same-page history updates are not redirects.
      let loads = 0;
      page.on("load", () => {
        loads += 1;
      });
      await page.goto("/tickets");
      await expect(page).toHaveURL(/\/login\?next=%2Ftickets$/);
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      await page.waitForTimeout(1500);
      // The page itself, then the sign-in page. A loop would keep adding loads.
      expect(loads).toBeLessThanOrEqual(2);
      await expect(page).toHaveURL(/\/login/);
    },
  );
});

plain.describe("invite and reset links", () => {
  plain("a valid invite lets the person set a password and signs them in", async ({ page }) => {
    await page.goto("/welcome/valid-token");
    await expect(page.getByRole("heading", { name: "Welcome, Neha" })).toBeVisible();
    await page.getByLabel("New password").fill("short");
    await expect(
      page.getByRole("listitem").filter({ hasText: "At least 10 characters" }),
    ).toContainText("not yet");
    await page.getByLabel("New password").fill("field-visit-2026");
    await page.getByLabel("Type it again").fill("field-visit-2026");
    await page.getByRole("button", { name: "Set password and sign in" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  plain("mismatched passwords are caught before sending", async ({ page }) => {
    await page.goto("/welcome/valid-token");
    await page.getByLabel("New password").fill("field-visit-2026");
    await page.getByLabel("Type it again").fill("field-visit-2027");
    await page.getByRole("button", { name: "Set password and sign in" }).click();
    await expect(page.getByText("The two passwords don't match.")).toBeVisible();
  });

  plain("a used or expired link explains what to do", async ({ page }) => {
    await page.goto("/reset-password/old-token");
    await expect(page.getByText("This link can't be used")).toBeVisible();
    await expect(page.getByText(/Ask an administrator for a new one/)).toBeVisible();
  });
});

test.describe("users and roles", () => {
  test("an administrator invites someone and gets a one-time link", async ({ page }) => {
    await page.goto("/settings/users");
    await expect(page.getByText("kiran@example.com")).toBeVisible();
    await page.getByRole("button", { name: "Invite user" }).click();

    const drawer = page.getByRole("dialog", { name: "Invite a user" });
    await drawer.getByRole("button", { name: "Create invite link" }).click();
    await expect(drawer.getByText("Enter their full name.")).toBeVisible();

    await drawer.getByLabel("Full name").fill("Priya Nair");
    await drawer.getByLabel("Work email").fill("priya@example.com");
    await drawer.getByLabel("Role").selectOption({ label: "Service manager" });
    await drawer.getByLabel("Region").selectOption("r-central");
    await drawer.getByRole("button", { name: "Create invite link" }).click();

    const linkDialog = page.getByRole("dialog", { name: "Invite link for Priya Nair" });
    await expect(linkDialog.getByLabel("Link")).toHaveValue(/\/welcome\/valid-token$/);
    await linkDialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("priya@example.com")).toBeVisible();
  });

  test("filters sit on one row on desktop instead of stretching", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/settings/users");
    const role = await page.getByLabel("Role", { exact: true }).boundingBox();
    const status = await page.getByLabel("Status", { exact: true }).boundingBox();
    expect(role!.width).toBeLessThan(260);
    expect(Math.abs(role!.y - status!.y)).toBeLessThan(2);
  });

  test("a duplicate email is flagged on the email field", async ({ page }) => {
    await page.goto("/settings/users");
    await page.getByRole("button", { name: "Invite user" }).click();
    const drawer = page.getByRole("dialog", { name: "Invite a user" });
    await drawer.getByLabel("Full name").fill("Kiran Again");
    await drawer.getByLabel("Work email").fill("kiran@example.com");
    await drawer.getByLabel("Role").selectOption({ label: "Service engineer" });
    await drawer.getByRole("button", { name: "Create invite link" }).click();
    await expect(drawer.getByText("Someone with that email already has an account.")).toBeVisible();
  });

  test("a reset link asks the administrator to confirm their password first", async ({ page }) => {
    await page.goto("/settings/users");
    await page.getByRole("button", { name: "More actions for Kiran Shetty" }).click();
    await page.getByRole("button", { name: "Password reset link" }).click();

    const confirm = page.getByRole("dialog", { name: "Confirm it's you" });
    await confirm.getByLabel("Your password").fill("wrong-password");
    await confirm.getByRole("button", { name: "Confirm" }).click();
    await expect(confirm.getByText("That password is incorrect.")).toBeVisible();

    await confirm.getByLabel("Your password").fill("admin-password-1");
    await confirm.getByRole("button", { name: "Confirm" }).click();
    await expect(
      page.getByRole("dialog", { name: "Password reset link for Kiran Shetty" }),
    ).toBeVisible();
  });

  test("signing out ends the session and says so", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Account menu for/ }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login\?signedOut=1$/);
    await expect(page.getByRole("status")).toHaveText("You've signed out.");
    await page.goto("/tickets");
    await expect(page).toHaveURL(/\/login/);
  });
});

plain.describe("role-based menus", () => {
  plain(
    "an engineer doesn't see admin screens in the menu or in search",
    async ({ page, context, baseURL }) => {
      await signIn(context, baseURL!, "ENGINEER");
      await page.goto("/");
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link", { name: "Tickets", exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Users & roles" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Finance" })).toHaveCount(0);

      await page.keyboard.press("ControlOrMeta+k");
      await page.getByRole("combobox").fill("users");
      await expect(page.getByRole("option", { name: /Users & roles/ })).toHaveCount(0);
    },
  );

  plain(
    "an engineer opening the users screen is told they lack access",
    async ({ page, context, baseURL }) => {
      await signIn(context, baseURL!, "ENGINEER");
      await page.goto("/settings/users");
      await expect(page.getByText("You don't have access to this")).toBeVisible();
    },
  );
});

for (const scheme of ["light", "dark"] as const) {
  plain(`sign-in and link pages have no WCAG AA violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const path of ["/login", "/welcome/valid-token"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => `${path}: ${v.id}`)).toEqual([]);
    }
  });
}
