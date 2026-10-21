import { expect, test, type Page } from "@playwright/test";
import { financeRange } from "@/lib/financial-analytics";
import { financialFixture } from "../ui/financial-data";
import { formatCurrency } from "@/lib/utils";

test("large purchases and negative profit retain unbroken readable amounts", async ({ page }) => {
  await page.route("**/api/reports/analytics?**", route => {
    const value = financialFixture(financeRange("month"));
    Object.assign(value.metrics, { revenue: 35299, cogs: 7925001.83, gross_profit: -7889702.83, expenses: 123.01, net_operating_profit: -7889825.84 });
    value.purchases_total = 1000309122;
    value.trend = [{ bucket_start: value.to + "T00:00:00+05:00", sale_date: value.to, revenue: 35299, gross_profit: -7889702.83 }];
    return route.fulfill({ json: value });
  });
  await page.goto("/dashboard?shell=1");
  await page.getByRole("button", { name: "This Month", exact: true }).click();
  const totals = page.getByLabel("Financial totals");
  for (const amount of [1000309122, -7889702.83, -7889825.84]) {
    const number = totals.getByText(formatCurrency(amount), { exact: true });
    await expect(number).toBeVisible();
    expect(await number.evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      return { lines: range.getClientRects().length, fits: element.scrollWidth <= element.clientWidth + 1, nowrap: getComputedStyle(element).whiteSpace };
    })).toEqual({ lines: 1, fits: true, nowrap: "nowrap" });
  }
  const trend = page.getByLabel("Revenue and Profit trend", { exact: true });
  await expect(trend.locator("svg[role=application]")).toBeVisible();
  await expect(trend).toContainText("M");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/financial-audit-large-${test.info().project.name}.png`, fullPage: true });
});

async function renderedTrend(page: Page, hourly: boolean) {
  const trend = page.getByLabel("Revenue and Profit trend", { exact: true });
  await expect(trend.locator("svg[role=application]")).toBeVisible();
  await expect(trend.locator(".recharts-line")).toHaveCount(2);
  // Recharts portals one-point dots outside the otherwise empty line groups.
  const marks = trend.locator(".recharts-line-curve, .recharts-line-dot");
  await expect.poll(() => marks.evaluateAll(elements => elements.filter(element => (element as SVGGeometryElement).getTotalLength() > 0).length)).toBe(2);
  await expect(trend.locator(".recharts-legend-wrapper")).toContainText("Revenue");
  await expect(trend.locator(".recharts-legend-wrapper")).toContainText("Gross Profit");
  await expect(trend).toContainText(hourly ? "Hours in Asia/Karachi" : "Daily totals");
  await trend.locator("svg[role=application]").scrollIntoViewIfNeeded();
  // Target the final plotted bucket. A fixed offset from the SVG edge can
  // select the previous day when a month is compressed onto a phone.
  const lastPoint = await marks.evaluateAll(elements => {
    const path = elements.find(element => (element as SVGGeometryElement).getTotalLength() > 0) as SVGGeometryElement;
    const point = path.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(lastPoint.x, lastPoint.y);
  const tooltip = trend.locator(".recharts-default-tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Revenue");
  await expect(tooltip).toContainText("Gross Profit");
  await expect(tooltip).toContainText(formatCurrency(hourly ? 27500 : 47500));
  await page.mouse.move(0, 0);
}

test("Owner switches Today, Monday-based week and month without reloading the page", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/api/reports/analytics?**", async route => {
    const url = new URL(route.request().url()); requests.push(url);
    await route.fulfill({ json: financialFixture(financeRange(url.searchParams.get("period")!)) });
  });
  await page.goto("/dashboard?shell=1");
  await expect(page.getByRole("heading", { name: "Revenue and Profit trend" })).toBeVisible();
  await expect(page.getByLabel("Financial totals")).toContainText("Today's Purchases");
  await expect(page.getByLabel("Financial totals")).toContainText("12,500");
  await renderedTrend(page, true);
  await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const [label, period] of [["This Week", "week"], ["This Month", "month"], ["Today", "today"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(requests.at(-1)?.searchParams.get("from")).toBe(financeRange(period).from);
    await expect(page).toHaveURL(new RegExp("period=" + period));
    await renderedTrend(page, period === "today");
  }
  await expect(page.getByLabel("Financial totals")).toContainText("Net Operating Profit");
  await expect(page.getByLabel("Financial totals")).toContainText("2,500");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a single-day report renders real point markers and usable tooltips", async ({ page }) => {
  await page.goto("/reports?shell=1&from=2026-01-01&to=2026-01-01");
  await renderedTrend(page, false);
  const trend = page.getByLabel("Revenue and Profit trend", { exact: true });
  await expect(trend.locator(".recharts-dot")).toHaveCount(2);
});

test("Reports show real response totals, negative profit, custom filters and aligned CSV links", async ({ page }) => {
  await page.route("**/api/reports/analytics?**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: financialFixture(financeRange(url.searchParams.get("period")!, url.searchParams.get("from")!, url.searchParams.get("to")!)) });
  });
  await page.goto("/reports?shell=1");
  await expect(page.getByRole("heading", { name: "Financial summary", exact: true })).toBeVisible();
  for (const heading of ["Expenses vs Profit", "Sales vs Purchases", "Best-selling medicines", "Expense categories", "Daily sales summary"]) await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  for (const label of ["Expenses vs Profit comparison", "Sales vs Purchases comparison"]) {
    const chart = page.getByLabel(label, { exact: true });
    await expect(chart.locator("svg[role=application]")).toBeVisible();
    await expect(chart.locator(".recharts-bar")).toHaveCount(2);
    const bar = chart.locator(".recharts-bar").last().locator(".recharts-rectangle").last();
    await bar.hover();
    await expect(chart.locator(".recharts-default-tooltip")).toBeVisible();
    if (label.startsWith("Sales")) await expect(chart.locator(".recharts-default-tooltip")).toContainText(formatCurrency(12500));
  }
  await expect(page.getByText("Extra Charges Collected", { exact: true })).toBeVisible();
  await expect(page.getByText("Rent", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Custom dates", exact: true }).click();
  await page.getByRole("form", { name: "Date range" }).getByLabel("From", { exact: true }).fill("2026-01-01");
  await page.getByRole("form", { name: "Date range" }).getByLabel("To", { exact: true }).fill("2026-01-31");
  await page.getByRole("button", { name: "Apply dates" }).click();
  await expect(page).toHaveURL(/from=2026-01-01&to=2026-01-31/);
  await expect(page.getByRole("link", { name: "Sales CSV", exact: true })).toHaveAttribute("href", /from=2026-01-01&to=2026-01-31/);
  await renderedTrend(page, false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/financial-reports-${test.info().project.name}.png`, fullPage: true });
});

test("loading failure keeps previous figures visible and Retry fetches updated transactions", async ({ page }) => {
  let calls = 0;
  let releaseFailure!: () => void;
  const pendingFailure = new Promise<void>(resolve => { releaseFailure = resolve; });
  await page.route("**/api/reports/analytics?**", async route => {
    calls++;
    if (calls === 1) { await pendingFailure; return route.fulfill({ status: 503, json: { error: "Financial figures could not load." } }); }
    const value = financialFixture(financeRange("week")); value.metrics.sales_count = 21;
    return route.fulfill({ json: value });
  });
  await page.goto("/dashboard?shell=1");
  await page.getByRole("button", { name: "This Week", exact: true }).click();
  await expect(page.getByText("Loading financial figures…", { exact: true })).toBeVisible();
  releaseFailure();
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
