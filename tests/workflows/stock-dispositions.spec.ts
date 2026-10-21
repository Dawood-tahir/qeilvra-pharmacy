import { expect, test } from "@playwright/test";
import { purchase, suppliers } from "../ui/data";
import { stockBatchId, stockReturnId } from "../ui/stock-data";
import { financeRange } from "@/lib/financial-analytics";
import { financialFixture } from "../ui/financial-data";
import { formatCurrency } from "@/lib/utils";

test("loss preview preserves decimal text on a half-paisa boundary", async ({ page }) => {
  await page.goto("/stock?shell=1&stock=1&cost-precision=1");
  await page.getByRole("button", { name: "Discard Stock", exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog", { name: "Discard Stock", exact: true });
  await dialog.getByLabel("Quantity (tablets)", { exact: true }).fill("1");
  await expect(dialog.getByText("Recorded batch cost:")).toContainText(formatCurrency(1.23));
});

test("partial expired disposal previews batch cost and requires physical confirmation", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/__test/dispose-stock", async route => { submitted = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, id: submitted!.key, quantity: 193, value: 14 } }); });
  await page.goto("/stock?shell=1&stock=1");
  await page.getByRole("button", { name: "Discard Stock", exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog", { name: "Discard Stock", exact: true });
  await dialog.getByLabel("Quantity (tablets)", { exact: true }).fill("7");
  await expect(dialog.getByText("Recorded batch cost:")).toContainText("14");
  await expect(dialog.getByLabel("Reason", { exact: true })).toHaveValue("Expired stock");
  await dialog.getByRole("button", { name: "Confirm Discard Stock", exact: true }).click();
  expect(submitted).toBeUndefined();
  await dialog.getByRole("checkbox").check();
  await page.screenshot({ path: `test-results/discard-confirmation-${test.info().project.name}.png`, fullPage: true });
  await dialog.getByRole("button", { name: "Confirm Discard Stock", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(submitted).toMatchObject({ batchId: stockBatchId, quantity: 7, expectedQuantity: 200, kind: "discard", removed: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("reports use returned stock cost and actual recoveries to reduce operating profit once", async ({ page }) => {
  await page.route("**/api/reports/analytics?**", async route => {
    const range = financeRange(new URL(route.request().url()).searchParams.get("period")!);
    const value = financialFixture(range);
    const inventory = { stock_written_off: 14, supplier_returns_value: 30, supplier_recoveries: 12, supplier_replacements_value: 8, net_inventory_loss: 24, net_operating_profit: -2524 };
    Object.assign(value.metrics, inventory); Object.assign(value.daily.at(-1)!, inventory);
    await route.fulfill({ json: value });
  });
  await page.goto("/reports?shell=1");
  await page.getByRole("button", { name: "This Week", exact: true }).click();
  const inventory = page.getByLabel("Inventory loss totals");
  for (const [label, amount] of [["Expired/Damaged Stock Written Off", "Rs 14"], ["Stock Value Returned to Suppliers", "Rs 30"], ["Confirmed Supplier Refunds/Credits", "Rs 12"], ["Net Inventory Loss", "Rs 24"]]) await expect(inventory.locator(".q-card").filter({ has: page.getByText(label, { exact: true }) })).toContainText(amount);
  const totals = page.getByLabel("Financial totals");
  for (const [label, amount] of [["This Week's Net Operating Profit", formatCurrency(-2524)], ["This Week's Sales", formatCurrency(47500)], ["This Week's Expenses", formatCurrency(20000)]]) await expect(totals.locator(".q-card").filter({ has: page.getByText(label, { exact: true }) })).toContainText(amount);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("supplier return uses the original purchase supplier and safely retries uncertain outcomes", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/__test/dispose-stock", async route => { requests.push(route.request().postDataJSON()); await route.fulfill({ json: requests.length === 1 ? { ok: false, uncertain: true, error: "Connection interrupted. Retry this same stock action." } : { ok: true, id: requests[0].key } }); });
  await page.goto("/stock?shell=1&stock=1");
  await page.getByRole("button", { name: "Return to Supplier", exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog", { name: "Return to Supplier", exact: true });
  await expect(dialog).toContainText(suppliers[0].name);
  await expect(dialog).toContainText("from this batch’s purchase");
  await dialog.getByLabel("Quantity (tablets)", { exact: true }).fill("10");
  await dialog.getByLabel("Reason", { exact: true }).fill("Damaged stock returned to dealer");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Confirm Return to Supplier", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Retry");
  await expect(dialog.getByLabel("Quantity (tablets)", { exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "Return to Supplier", exact: true }).filter({ visible: true }).click();
  await expect(dialog.getByLabel("Quantity (tablets)", { exact: true })).toHaveValue("10");
  await dialog.getByRole("button", { name: "Retry Stock Action", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({ kind: "supplier_return", supplierId: suppliers[0].id });
});

test("pending supplier credit accepts the actual confirmed amount without a second stock removal", async ({ page }) => {
  let settlement: Record<string, unknown> | undefined;
  await page.route("**/__test/supplier-recovery", async route => { settlement = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, id: stockReturnId } }); });
  await page.goto("/stock?shell=1&stock=1");
  await expect(page.getByText("Pending credit", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Record Supplier Settlement", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Record Supplier Settlement", exact: true });
  await expect(dialog).toContainText("Stock has already been removed.");
  await dialog.getByLabel("Actual credited / refunded amount (Rs.)", { exact: true }).fill("12");
  await dialog.getByLabel("Supplier reference (optional)", { exact: true }).fill("Credit note 123");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Confirm Settlement", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(settlement).toMatchObject({ dispositionId: stockReturnId, method: "credit", amount: 12, reference: "Credit note 123", confirmed: true, replacement: null });
});

test("replacement settlement collects a real new batch and history remains linked", async ({ page }) => {
  let settlement: Record<string, unknown> | undefined;
  await page.route("**/__test/supplier-recovery", async route => { settlement = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, id: stockReturnId } }); });
  await page.goto("/stock?shell=1&stock=1");
  await page.getByRole("button", { name: "Record Supplier Settlement", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Record Supplier Settlement", exact: true });
  await dialog.getByLabel("Settlement type", { exact: true }).selectOption("replacement");
  await dialog.getByLabel("Replacement batch", { exact: true }).fill("NEW-BATCH");
  await dialog.getByLabel("Replacement expiry", { exact: true }).fill("2099-12-25");
  await dialog.getByLabel("Replacement quantity (tablets)", { exact: true }).fill("4");
  await dialog.getByLabel("Recorded replacement value (Rs.)", { exact: true }).fill("8");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Confirm Settlement", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(settlement).toMatchObject({ method: "replacement", amount: 8, replacement: { batch_number: "NEW-BATCH", expiry_date: "2099-12-25", quantity: 4 } });
  await expect(page.getByRole("link", { name: "Original purchase", exact: true })).toHaveAttribute("href", "/purchases/" + purchase.id);
  await page.goto("/suppliers/" + suppliers[0].id + "?shell=1&stock=1");
  await expect(page.getByRole("heading", { name: "Supplier returns & recoveries", exact: true })).toBeVisible();
  await expect(page.getByText("Damaged tablets returned to original dealer", { exact: true })).toBeVisible();
  await page.goto("/purchases/" + purchase.id + "?shell=1&stock=1");
  await expect(page.getByRole("heading", { name: "Supplier returns & recoveries", exact: true })).toBeVisible();
  await expect(page.getByText("Pending credit", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
