import { expect, test } from "@playwright/test";

test("protected routes redirect anonymous users", async ({ page }) => {
  await page.goto("/pos");
  await expect(page).toHaveURL(/\/login/);
});

test("login is usable without horizontal overflow", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: `test-results/login-${test.info().project.name}.png`, fullPage: true, caret: "initial" });
});

test.describe("configured authenticated flows", () => {
  test.skip(!process.env.E2E_SALESPERSON_EMAIL || !process.env.E2E_SALESPERSON_PASSWORD, "Set E2E salesperson credentials.");
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email address").fill(process.env.E2E_SALESPERSON_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_SALESPERSON_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("mobile navigation exposes counter workflow", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 1024, "Mobile navigation applies below 1024px.");
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
    await expect(page.getByText("POS", { exact: true })).toBeVisible();
    await expect(page.getByText("Reports", { exact: true })).toHaveCount(0);
  });

  test("mobile POS keeps cart checkout within reach", async ({ page }) => {
    await page.goto("/pos");
    await expect(page.getByLabel("Medicine search")).toBeVisible();
    if ((page.viewportSize()?.width ?? 0) < 1024) await expect(page.getByRole("button", { name: /View cart|Cart & Checkout/i })).toBeVisible();
    else await expect(page.getByRole("complementary", { name: "Cart" })).toBeVisible();
  });
});
