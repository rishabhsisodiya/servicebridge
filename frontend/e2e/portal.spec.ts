import { expect, test } from "./fixtures";

/**
 * Customer portal: magic-link sign-in and the proxy's optimistic cookie gate.
 * The stub API has no portal endpoints, so these tests stay on the pages that
 * work without one (login, verify-without-token, and the redirect itself).
 */
test.describe("customer portal", () => {
  test("signed-out visitors are sent to the portal login", async ({ page }) => {
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/portal\/login\?next=%2Fportal$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Customer portal");
  });

  test("the login page offers a magic link", async ({ page }) => {
    await page.goto("/portal/login");
    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Email me a sign-in link" }),
    ).toBeVisible();
  });

  test("deep portal pages keep their destination in the next parameter", async ({
    page,
  }) => {
    await page.goto("/portal/tickets/new");
    await expect(page).toHaveURL(/\/portal\/login\?next=%2Fportal%2Ftickets%2Fnew$/);
  });

  test("the verify page explains a truncated link", async ({ page }) => {
    await page.goto("/portal/auth/verify");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign-in link");
    await expect(page.getByText("This link is incomplete")).toBeVisible();
  });

  test("the verify page fails gracefully without the real API", async ({ page }) => {
    // The stub API has no portal endpoints, so the token exchange 404s and the
    // page shows its error state instead of hanging.
    await page.goto("/portal/auth/verify?token=stub-token");
    await expect(page.getByText("Couldn't sign you in")).toBeVisible();
  });
});
