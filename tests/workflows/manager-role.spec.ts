import { expect, test } from "@playwright/test";
import { medicine, suppliers } from "../ui/data";

test.beforeEach(async ({ page }) => {
  await page.route("**/__test/inventory?**", route => route.fulfill({ json: [medicine] }));
});

test("Manager dashboard shows operations without financial summaries or report navigation", async ({ page }) => {
  await page.goto("/dashboard?shell=1&role=manager");
  await expect(page.getByText("Manager workspace", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Financial totals")).toHaveCount(0);
  await expect(page.getByLabel("Revenue and Profit trend", { exact: true })).toHaveCount(0);
  await expect(page.getByText("My Sales Today", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Amount", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View Reports", exact: true })).toHaveCount(0);
  for (const name of ["Reports", "Staff", "Audit Log"]) await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add New Medicine", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add More Stock", exact: true })).toBeVisible();
});

test("Manager can open inventory editing and expense entry without expense totals", async ({ page }) => {
  await page.goto("/medicines?role=manager");
  await expect(page.getByRole("link", { name: "Add New Medicine", exact: true })).toBeVisible();
  await page.goto("/expenses?role=manager");
  await expect(page.getByText("Record expense", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Selected total", { exact: true })).toHaveCount(0);
});

test("Manager supplier overview retains operational history without spend totals", async ({ page }) => {
  await page.goto(`/suppliers/${suppliers[0].id}?role=manager`);
  await expect(page.getByRole("heading", { name: suppliers[0].name, exact: true })).toBeVisible();
  await expect(page.getByText("Distinct medicines supplied", { exact: true })).toBeVisible();
  await expect(page.getByText("Total stock deliveries", { exact: true })).toBeVisible();
  await expect(page.getByText("Total Purchase Value", { exact: true })).toHaveCount(0);
});

test("Owner retains administration and can choose Manager for a secure invitation", async ({ page }) => {
  await page.goto("/users?shell=1");
  await expect(page.getByRole("heading", { name: "Staff", exact: true })).toBeVisible();
  await page.getByText("Invite staff member", { exact: true }).click();
  await page.getByRole("combobox", { name: "Role *", exact: true }).selectOption("manager");
  await expect(page.getByRole("combobox", { name: "Role *", exact: true })).toHaveValue("manager");
  await expect(page.getByRole("button", { name: "Send secure invitation", exact: true })).toBeVisible();
});
