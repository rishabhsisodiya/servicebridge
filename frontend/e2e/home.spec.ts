import { signIn } from "./fixtures";
import { expect, test } from "@playwright/test";

test.describe("home and notifications", () => {
  test("the bell shows unread notifications and opens the ticket", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL!);
    await page.goto("/");
    const bell = page.getByRole("button", { name: "Notifications, 1 unread" });
    await expect(bell).toBeVisible();
    await bell.click();
    await page.getByRole("button", { name: /resolution time at risk/ }).click();
    await expect(page).toHaveURL(/\/tickets\/ET-26-000415$/);
    await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  });

  test("a manager sees engineers and can change their availability", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL!);
    await page.goto("/");
    const engineers = page.getByRole("region", { name: "Engineers" });
    await expect(engineers.getByText("On visit", { exact: true })).toBeVisible();
    await engineers.getByLabel("Availability of Vikas Rao").selectOption("ON_DUTY");
    await expect(
      page.getByRole("status").filter({ hasText: "Vikas Rao is now on duty" }),
    ).toBeVisible();
  });

  test("an engineer switches themselves off duty", async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, "ENGINEER");
    await page.goto("/");
    const duty = page.getByRole("radiogroup", { name: "My availability" });
    await duty.getByRole("radio", { name: "Off duty" }).click();
    await expect(page.getByRole("status").filter({ hasText: "You're off duty" })).toBeVisible();
  });
});
