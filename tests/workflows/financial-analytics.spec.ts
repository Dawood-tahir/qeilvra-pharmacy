import { expect, test } from "@playwright/test";
import { financeRange } from "@/lib/financial-analytics";
import { financialFixture } from "../ui/financial-data";

test("Owner switches Today, Monday-based week and month without reloading the page", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/api/reports/analytics?**", async route => {
    const url = new URL(route.request().url()); requests.push(url);
    await route.fulfill({ json: financialFixture(financeRange(url.searchParams.get("period")!)) });
  });
  await page.goto("/dashboard?shell=1");
  await expect(page.getByRole("heading", { name: "Revenue and Profit trend" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const [label, period] of [["This Week", "week"], ["This Month", "month"], ["Today", "today"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(requests.at(-1)?.searchParams.get("from")).toBe(financeRange(period).from);
    await expect(page).toHaveURL(new RegExp("period=" + period));
  }
  await expect(page.getByLabel("Financial totals")).toContainText("Net Operating Profit");
  await expect(page.getByLabel("Financial totals")).toContainText("2,500");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Reports show real response totals, negative profit, custom filters and aligned CSV links", async ({ page }) => {
  await page.route("**/api/reports/analytics?**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: financialFixture(financeRange(url.searchParams.get("period")!, url.searchParams.get("from")!, url.searchParams.get("to")!)) });
  });
  await page.goto("/reports?shell=1");
  await expect(page.getByRole("heading", { name: "Financial summary", exact: true })).toBeVisible();
  for (const heading of ["Expenses vs Profit", "Best-selling medicines", "Expense categories", "Daily sales summary"]) await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.getByText("Extra Charges Collected", { exact: true })).toBeVisible();
  await expect(page.getByText("Rent", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Custom dates", exact: true }).click();
  await page.getByRole("form", { name: "Date range" }).getByLabel("From", { exact: true }).fill("2026-01-01");
  await page.getByRole("form", { name: "Date range" }).getByLabel("To", { exact: true }).fill("2026-01-31");
  await page.getByRole("button", { name: "Apply dates" }).click();
  await expect(page).toHaveURL(/from=2026-01-01&to=2026-01-31/);
  await expect(page.getByRole("link", { name: "sales CSV", exact: true })).toHaveAttribute("href", /from=2026-01-01&to=2026-01-31/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/financial-reports-${test.info().project.name}.png`, fullPage: true });
});

test("loading failure keeps previous figures visible and Retry fetches updated transactions", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/reports/analytics?**", async route => {
    calls++;
    if (calls === 1) { await new Promise(resolve => setTimeout(resolve, 250)); return route.fulfill({ status: 503, json: { error: "Financial figures could not load." } }); }
    const value = financialFixture(financeRange("week")); value.metrics.sales_count = 21;
    return route.fulfill({ json: value });
  });
  await page.goto("/dashboard?shell=1");
  await page.getByRole("button", { name: "This Week", exact: true }).click();
  await expect(page.getByText("Loading financial figures…", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("last loaded figures");
  await expect(page.getByLabel("Financial totals")).toContainText("47,500");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "This Week", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Financial totals")).toContainText("21");
});

test("empty reports and salesperson dashboard do not invent financial information", async ({ page }) => {
  await page.goto("/reports?shell=1&empty=1");
  await expect(page.getByText("No sales, refunds or expenses in this period.")).toBeVisible();
  await expect(page.getByText("No operating expenses recorded.")).toBeVisible();
  await page.goto("/dashboard?shell=1&role=salesperson");
  await expect(page.getByText("My Sales Today", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Financial analytics")).toHaveCount(0);
  await expect(page.getByText("Net Operating Profit", { exact: true })).toHaveCount(0);
});

test("visible dashboard automatically refreshes after transaction changes", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/reports/analytics?**", route => { calls++; const value = financialFixture(); value.metrics.sales_count = 25; return route.fulfill({ json: value }); });
  await page.clock.install();
  await page.goto("/dashboard?shell=1");
  await expect(page.getByLabel("Financial totals")).toContainText("20");
  await page.clock.fastForward(31000);
  await expect.poll(() => calls).toBeGreaterThan(0);
  await expect(page.getByLabel("Financial totals")).toContainText("25");
});
