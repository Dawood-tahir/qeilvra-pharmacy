import { expect, test } from "@playwright/test";
import { formatDate } from "@/lib/utils";
import { medicine } from "../ui/data";
const id = "50000000-0000-4000-8000-000000000005";
const path = `/suppliers/${id}`;
const visible = { visible: true } as const;

test("supplier cards navigate while Deactivate stays a separate action", async ({ page }) => {
  await page.goto("/suppliers");
  const card = page.getByRole("article").filter({ hasText: "City Medical Supplies" });
  await expect(card.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Deactivate", exact: true }).locator("xpath=ancestor::a")).toHaveCount(0);
  await card.getByText("City Medical Supplies", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "City Medical Supplies" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Suppliers" })).toBeVisible();
  await expect(page.getByText("15", { exact: true })).toBeVisible();
  await expect(page.getByText("2,990", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("orders@city-medical-supplies.example.test")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/supplier-profile-${test.info().project.name}.png`, fullPage: true });
});

test("alerts use pharmacy stock, exclude unavailable batches, and link to restocking", async ({ page }) => {
  await page.goto(path + "?tab=alerts");
  await expect(page.getByRole("heading", { name: "Medicines Needing Attention" })).toBeVisible();
  await expect(page.getByText("5 tablets", { exact: true }).filter(visible)).toBeVisible();
  await expect(page.getByText("0 capsules", { exact: true }).filter(visible)).toBeVisible();
  await expect(page.getByText("Out of Stock", { exact: true }).filter(visible)).toBeVisible();
  await expect(page.getByText("Expiring Soon", { exact: true }).filter(visible)).toBeVisible();
  await expect(page.getByRole("link", { name: "Add More Stock", exact: true }).filter(visible).first()).toHaveAttribute("href", /supplier=50000000/);
  await page.getByRole("textbox", { name: "Search medicines" }).fill("Omeprazole");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("1 result · Page 1 of 1")).toBeVisible();
  await expect(page.getByText("100 capsules", { exact: true }).filter(visible)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a supplier invoice opens the existing purchase details", async ({ page }) => {
  await page.goto(path + "?tab=history&q=CITY-15");
  await page.getByRole("link", { name: "View invoice", exact: true }).filter(visible).click();
  await expect(page.getByRole("heading", { name: "PUR-PROFILE-15", exact: true })).toBeVisible();
  await expect(page.getByText(/City Medical Supplies.*CITY-15/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Purchased items", exact: true })).toBeVisible();
  await expect(page.getByText("REPEAT-BATCH", { exact: true }).filter(visible)).toBeVisible();
});

test("restocking from a supplier alert preselects the existing medicine and supplier", async ({ page }) => {
  await page.route("**/__test/inventory?**", (route) => route.fulfill({ json: [medicine] }));
  await page.goto(path + "?tab=alerts&q=Paracetamol");
  await page.getByRole("link", { name: "Add More Stock", exact: true }).filter(visible).click();
  await expect(page.getByRole("heading", { name: "Add More Stock", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Paracetamol 500mg", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Purchased From/ })).toHaveValue("City Medical Supplies");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("repeated medicine deliveries retain batches, saved units, costs, dates and invoices across pages", async ({ page }) => {
  await page.goto(path + "?tab=medicines");
  await expect(page.getByText("15 results · Page 1 of 2")).toBeVisible();
  await expect(page.getByText("REPEAT-BATCH", { exact: false }).filter(visible)).toHaveCount(12);
  await expect(page.getByText("2 boxes", { exact: true }).filter(visible)).toHaveCount(12);
  await expect(page.getByText("200 tablets total", { exact: true }).filter(visible).first()).toBeVisible();
  await expect(page.getByText(/100.*\/ box/).filter(visible).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /PUR-PROFILE-15/ }).filter(visible)).toBeVisible();
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await expect(page.getByText("15 results · Page 2 of 2")).toBeVisible();
  await expect(page.getByRole("link", { name: /PUR-PROFILE-01/ }).filter(visible)).toBeVisible();
  await expect(page.getByText(formatDate("2026-10-01"), { exact: true }).filter(visible)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("purchase history separates drafts from received stock and supports invoice search", async ({ page }) => {
  await page.goto(path + "?tab=history&status=draft");
  await expect(page.getByText("1 result · Page 1 of 1")).toBeVisible();
  await expect(page.getByText("Draft", { exact: true }).filter(visible)).toBeVisible();
  await expect(page.getByText("PUR-DRAFT", { exact: true }).filter(visible)).toBeVisible();
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("posted");
  await page.getByRole("textbox", { name: "Search invoice or supplier reference" }).fill("CITY-15");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("PUR-PROFILE-15", { exact: false }).filter(visible).first()).toBeVisible();
  await expect(page.getByText("Received", { exact: true }).filter(visible)).toBeVisible();
  await expect(page.getByRole("link", { name: "View invoice", exact: true }).filter(visible)).toHaveAttribute("href", /^\/purchases\//);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a supplier without purchases has clear zero summaries and empty sections", async ({ page }) => {
  await page.goto(path + "?fixture=empty");
  await expect(page.getByText("No purchases yet", { exact: true })).toBeVisible();
  await expect(page.getByText("No medicines need attention", { exact: true })).toBeVisible();
  await expect(page.getByText("No medicines received", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add More Stock", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
