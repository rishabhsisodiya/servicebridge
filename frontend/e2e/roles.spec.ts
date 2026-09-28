import { test as plain } from "@playwright/test";
import { expect, signIn, test } from "./fixtures";

test.describe("roles", () => {
  test("an administrator creates a role from another one after confirming their password", async ({
    page,
  }) => {
    await page.goto("/settings/roles");
    await expect(page.getByRole("heading", { name: "Roles", level: 1, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New role" }).click();

    const drawer = page.getByRole("dialog", { name: "New role" });
    await drawer.getByLabel("Name").fill("Dispatcher");
    await drawer.getByLabel("Start from").selectOption({ label: "Service engineer" });
    await expect(drawer.getByRole("radio", { name: /Their own/ })).toBeChecked();

    // Anything beyond Read turns Read on; turning Read off clears the row.
    await drawer.getByRole("checkbox", { name: "Users: Edit" }).check();
    await expect(drawer.getByRole("checkbox", { name: "Users: Read" })).toBeChecked();
    await drawer.getByRole("checkbox", { name: "Users: Read" }).uncheck();
    await expect(drawer.getByRole("checkbox", { name: "Users: Edit" })).not.toBeChecked();

    await drawer.getByRole("radio", { name: /Their region/ }).check();
    await drawer.getByRole("checkbox", { name: /Assign tickets/ }).check();
    await drawer.getByRole("button", { name: "Create role" }).click();

    const confirm = page.getByRole("dialog", { name: "Confirm it's you" });
    await confirm.getByLabel("Your password").fill("admin-password-1");
    await confirm.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByText("Dispatcher created.", { exact: false })).toBeVisible();
    const row = page.getByRole("row", { name: /Dispatcher/ });
    await expect(row).toContainText("Their region");
    await expect(row).toContainText("Tickets, Equipment, Spares & items");
  });

  test("the Administrator role can be viewed but not changed", async ({ page }) => {
    await page.goto("/settings/roles");
    await page.getByRole("button", { name: "Administrator", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Administrator" });
    await expect(drawer.getByText("This role can't be changed.", { exact: false })).toBeVisible();
    await expect(drawer.getByRole("checkbox", { name: "Roles: Delete" })).toBeDisabled();
    await expect(drawer.getByRole("button", { name: /Save/ })).toHaveCount(0);
    await drawer.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(drawer).toBeHidden();
  });

  test("built-in roles can't be deleted and roles in use say who to move first", async ({
    page,
  }) => {
    await page.goto("/settings/roles");
    await expect(page.getByRole("button", { name: "Delete Service engineer" })).toHaveCount(0);
    await page.getByRole("button", { name: "Delete Night desk" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete Night desk?" });
    await expect(dialog.getByRole("alert")).toHaveText(
      "2 people have this role. Give them another role first.",
    );
    await expect(dialog.getByRole("button", { name: "Delete role" })).toBeDisabled();
  });
});

plain(
  "people who can only read users and roles see no buttons to change them",
  async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, "VIEWER");
    await page.goto("/settings/users");
    await expect(page.getByRole("row", { name: /Kiran Shetty/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Invite user" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);

    await expect(page.getByRole("main").getByRole("link", { name: "Roles" })).toBeVisible();

    await page.goto("/settings/roles");
    await expect(page.getByRole("heading", { name: "Roles", level: 1, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "New role" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete Night desk" })).toHaveCount(0);
    await page.getByRole("button", { name: "View" }).nth(1).click();
    const drawer = page.getByRole("dialog", { name: "Service engineer" });
    await expect(drawer.getByLabel("Name")).toHaveAttribute("readonly", "");
    await expect(drawer.getByRole("button", { name: /Save/ })).toHaveCount(0);
  },
);
