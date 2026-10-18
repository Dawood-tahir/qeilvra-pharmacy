import { test, expect, type Page } from "@playwright/test";
import { medicine, purchase, sale, suppliers } from "../ui/data";

async function mockMedicines(page: Page) {
  await page.route("**/api/medicines/search?**", (route) => route.fulfill({ json: [medicine] }));
  await page.route("**/__test/inventory?**", (route) => route.fulfill({ json: [medicine] }));
}
async function stockFields(page: Page) {
  await page.getByRole("button", { name: "box", exact: true }).click();
  await page.getByLabel("How many did you buy?").fill("1");
  await page.getByLabel("Batch number").fill("RECEIVED-1");
  await page.getByLabel("Expiry date").fill("2099-12-25");
  await page.getByLabel("Total purchase cost").fill("200");
}
async function pickSupplier(page: Page, label = "Purchased From (Supplier)") {
  const picker = page.getByRole("combobox", { name: new RegExp(label.replace(/[()]/g, "\\$&")) });
  await picker.fill("city");
  await expect(page.getByRole("option")).toHaveCount(1);
  await picker.press("Enter");
  await expect(picker).toHaveValue(suppliers[0].name);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("saved supplier is searchable, retained on Back, reviewed and sent once with stock", async ({ page }) => {
  await mockMedicines(page);
  const requests: Record<string, unknown>[] = [];
  await page.route("**/__test/receive", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true, id: medicine.id, quantity: 100 } });
  });
  await page.goto("/?flow=restock&shell=1");
  await page.getByRole("button", { name: /Paracetamol/ }).click();
  await pickSupplier(page);
  await stockFields(page);
  await page.getByRole("button", { name: "Review Stock" }).click();
  await expect(page.getByRole("region", { name: "Stock receipt review" })).toContainText(suppliers[0].name);
  await expect(page.getByText("Stock after adding: 300 tablets")).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("combobox")).toHaveValue(suppliers[0].name);
  await page.getByRole("combobox").fill("north");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox")).toHaveValue(suppliers[0].name);
  await page.getByRole("button", { name: "Review Stock" }).click();
  await noOverflow(page);
  await page.screenshot({ path: "test-results/stock-review-" + test.info().project.name + ".png", fullPage: true });
  await page.getByRole("button", { name: "Add to Stock", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stock added successfully." })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ id: medicine.id, stock: { supplier_id: suppliers[0].id, unit_key: "box", quantity: 1 } });
});

test("supplier empty state opens the existing Suppliers screen", async ({ page }) => {
  await mockMedicines(page);
  await page.goto("/?flow=restock&suppliers=none&shell=1");
  await page.getByRole("button", { name: /Paracetamol/ }).click();
  await expect(page.getByText("No suppliers saved yet. Add one from Suppliers.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Suppliers" })).toHaveAttribute("href", "/suppliers");
});

test("unconfirmed stock save locks edits and retries the identical supplier receipt", async ({ page }) => {
  await mockMedicines(page);
  const requests: unknown[] = [];
  await page.route("**/__test/receive", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: requests.length === 1 ? { ok: false, uncertain: true, error: "Could not confirm the save. Retry the same stock receipt." } : { ok: true, id: medicine.id, quantity: 100 } });
  });
  await page.goto("/?flow=restock");
  await page.getByRole("button", { name: /Paracetamol/ }).click();
  await pickSupplier(page);
  await stockFields(page);
  await page.getByRole("button", { name: "Review Stock" }).click();
  await page.getByRole("button", { name: "Add to Stock" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not confirm");
  await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry Stock Save" }).click();
  await expect(page.getByRole("heading", { name: "Stock added successfully." })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

test("supplier keyboard navigation keeps the active option in view", async ({ page }) => {
  await mockMedicines(page);
  await page.goto("/?flow=restock");
  await page.getByRole("button", { name: /Paracetamol/ }).click();
  const picker = page.getByRole("combobox");
  await picker.click();
  for (let index = 0; index < 14; index++) await picker.press("ArrowDown");
  const active = await picker.getAttribute("aria-activedescendant");
  const visible = await page.evaluate((id) => {
    const option = document.getElementById(id!)!;
    const box = option.getBoundingClientRect();
    const list = option.parentElement!.getBoundingClientRect();
    return box.top >= list.top && box.bottom <= list.bottom;
  }, active);
  expect(visible).toBe(true);
  await picker.press("Enter");
  await expect(picker).toHaveValue("Supplier 13");
});

test("purchase draft preserves saved supplier and only explicit posting adds stock", async ({ page }) => {
  await mockMedicines(page);
  const drafts: Record<string, unknown>[] = [];
  const posts: unknown[] = [];
  await page.route("**/__test/purchase", async (route) => { drafts.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true, id: purchase.id } }); });
  await page.route("**/__test/post", async (route) => { posts.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true, message: "Purchase posted. Stock is now available." } }); });
  await page.goto("/purchases/new?shell=1");
  await pickSupplier(page, "Supplier");
  await page.getByLabel("Find a medicine").fill("PC");
  await page.getByRole("button", { name: /Paracetamol/ }).click();
  const item = page.getByRole("article", { name: "Paracetamol purchase item" });
  await item.getByLabel("Purchased unit").selectOption("box");
  await item.getByLabel("Quantity received").fill("2");
  await item.getByLabel("Cost of 1 box").fill("200");
  await item.getByLabel("Batch number").fill("BATCH-1");
  await item.getByLabel("Expiry date").fill("2098-12-25");
  await expect(item.getByText("200 tablets")).toBeVisible();
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: purchase.purchase_number })).toBeVisible();
  expect(drafts).toHaveLength(1);
  expect(drafts[0]).toMatchObject({ supplier_id: suppliers[0].id, items: [{ medicine_id: medicine.id, unit_key: "box", quantity: 2, unit_cost: 200 }] });
  expect(posts).toHaveLength(0);
  await expect(page.getByText("Draft only:")).toBeVisible();
  await noOverflow(page);
  await page.getByRole("button", { name: "Post Purchase to Stock" }).click();
  await expect(page.getByRole("status")).toContainText("Purchase posted");
  expect(posts).toEqual([{ id: purchase.id }]);
});

test("POS supports direct quantities and scanner keyboard use inside the actual app shell", async ({ page }) => {
  await mockMedicines(page);
  await page.goto("/pos?shell=1&role=salesperson");
  const card = page.getByRole("article", { name: "Paracetamol 500mg" });
  await expect(card).toBeVisible();
  await page.keyboard.press("F4");
  await expect(page.getByRole("textbox", { name: "Medicine search" })).toBeFocused();
  await page.getByRole("textbox", { name: "Medicine search" }).press("Enter");
  await expect(card.getByRole("button", { name: "tablet", exact: true })).toBeFocused();
  await card.getByRole("spinbutton", { name: "Quantity of Paracetamol tablet", exact: true }).fill("13");
  await card.getByRole("button", { name: "Add to Cart" }).click();
  await noOverflow(page);
  await page.screenshot({ path: "test-results/pos-shell-" + test.info().project.name + ".png", fullPage: true });
  if (page.viewportSize()!.width < 1024) await page.getByRole("button", { name: /Cart & Checkout/ }).click();
  const quantity = page.getByRole("spinbutton", { name: "Paracetamol tablet in cart" }).filter({ visible: true });
  await expect(quantity).toHaveValue("13");
  await quantity.fill("");
  await quantity.fill("15");
  await quantity.press("Tab");
  await expect(quantity).toHaveValue("15");
  await quantity.fill("201");
  await quantity.press("Tab");
  await expect(quantity).toHaveValue("15");
  await expect(page.getByText("Only 200 tablets are available.")).toBeVisible();
});

test("receipt return request identifies invoice, preserves unit and manages focus", async ({ page }) => {
  let payload: unknown;
  await page.route("**/__test/return", async (route) => { payload = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, id: "return" } }); });
  await page.goto("/?flow=receipt&shell=1");
  const trigger = page.getByRole("button", { name: "Request return", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Request a return" });
  await expect(dialog.getByText("Invoice " + sale.invoice_number)).toBeVisible();
  await expect(dialog.getByText("Sold: 3 strips")).toBeVisible();
  await dialog.getByLabel("Return quantity for Paracetamol strip").fill("1");
  await dialog.getByLabel("Reason for return").fill("One sealed strip returned");
  for (let index = 0; index < 6; index++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true); }
  await noOverflow(page);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "Send Return Request" }).click();
  await expect(dialog).toHaveCount(0);
  expect(payload).toMatchObject({ saleId: sale.id, reason: "One sealed strip returned", items: [{ sale_item_id: sale.sale_items[0].id, quantity: 1 }] });
});

test("Owner return review clearly separates approved quantity and restocking", async ({ page }) => {
  let payload: unknown;
  await page.route("**/__test/review", async (route) => { payload = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, refund: 65 } }); });
  await page.goto("/returns?shell=1");
  await expect(page.getByText(/Approved: 1/)).toContainText("Not returned to stock");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review return" });
  await expect(dialog.getByText("Invoice " + sale.invoice_number)).toBeVisible();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await dialog.getByRole("spinbutton").fill("1");
  await dialog.getByRole("checkbox").check();
  await noOverflow(page);
  await dialog.getByRole("button", { name: "Approve Refund" }).click();
  await expect(dialog).toHaveCount(0);
  expect(payload).toMatchObject({ approve: true, paymentMethod: "cash", items: [{ approved_quantity: 1, restockable: true }] });
});

test("expense errors keep entries and success is shown only after confirmation", async ({ page }) => {
  let attempts = 0;
  await page.route("**/__test/expense", async (route) => { attempts++; await route.fulfill({ json: attempts === 1 ? { ok: false, error: "Could not save this expense." } : { ok: true, message: "Expense recorded successfully." } }); });
  await page.goto("/expenses?shell=1");
  await page.getByLabel("Category", { exact: false }).first().selectOption("a0000000-0000-4000-8000-000000000001");
  await page.getByLabel("Amount (Rs.)").fill("500");
  await page.getByLabel("What was this expense for?").fill("Electricity bill");
  await page.getByRole("button", { name: "Record expense" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save");
  await expect(page.getByLabel("Amount (Rs.)")).toHaveValue("500");
  await page.getByRole("button", { name: "Record expense" }).click();
  await expect(page.getByRole("status")).toContainText("Expense recorded successfully");
  await expect(page.getByLabel("Amount (Rs.)")).toHaveValue("");
});

test("global search retries errors and finds an existing invoice by keyboard", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/search?**", (route) => { attempts++; return route.fulfill({ status: attempts === 1 ? 503 : 200, json: attempts === 1 ? { error: "Unavailable" } : [{ id: sale.id, type: "invoice", title: sale.invoice_number, subtitle: "Test sale", meta: "Rs. 195" }] }); });
  await page.goto("/sales?shell=1");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Global search" });
  await dialog.getByLabel("Search medicines or invoices").fill("QEI-TEST");
  await expect(dialog.getByRole("alert")).toContainText("Search could not load");
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByRole("button", { name: /QEI-TEST-0001/ })).toBeVisible();
  await dialog.getByLabel("Search medicines or invoices").press("ArrowDown");
  await expect(dialog.getByRole("button", { name: /QEI-TEST-0001/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText(sale.invoice_number, { exact: true })).toBeVisible();
});

test("date filters accept a different month in one apply", async ({ page }) => {
  await page.goto("/reports?shell=1");
  const form = page.getByRole("form", { name: "Date range" });
  await form.getByLabel("From", { exact: true }).fill("2026-01-01");
  await form.getByLabel("To", { exact: true }).fill("2026-01-31");
  await expect(form.getByLabel("To", { exact: true })).toHaveAttribute("min", "2026-01-01");
  await form.getByRole("button", { name: "Apply dates" }).click();
  await expect(page).toHaveURL(/from=2026-01-01&to=2026-01-31/);
});

for (const [flow, title] of [["dashboard", "Welcome back"], ["inventory", "Inventory"], ["purchase", "New purchase"], ["purchase-detail", "PUR-TEST-0001"], ["purchases", "Purchases"], ["suppliers", "Suppliers"], ["receipt", "Qeilvra Pharmacy"], ["returns", "Returns & refunds"], ["expenses", "Expenses"], ["reports", "Reports"], ["users", "Salespeople"], ["settings", "Settings"], ["alerts", "Stock alerts"], ["notifications", "Notifications"], ["stock", "Stock batches & corrections"]]) {
  test(flow + " is readable within the real desktop and mobile shell", async ({ page }) => {
    await mockMedicines(page);
    await page.goto("/?flow=" + flow + "&shell=1");
    await expect(page.getByRole("heading", { name: new RegExp(title) }).first()).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: "test-results/" + flow + "-shell-" + test.info().project.name + ".png", fullPage: true });
  });
}
