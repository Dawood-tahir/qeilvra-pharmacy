import { expect, test, type Page } from "@playwright/test";
import { medicine, sale, saleItem } from "../ui/data";

async function setup(page: Page, role = "owner") {
  await page.route("**/api/medicines/search?**", (route) => route.fulfill({ json: [medicine] }));
  await page.addInitScript(() => { window.print = () => sessionStorage.setItem("test-print-count", String(Number(sessionStorage.getItem("test-print-count") ?? 0) + 1)); });
  await page.goto("/?flow=pos&shell=1&role=" + role);
}
async function cart(page: Page) {
  if (page.viewportSize()!.width < 1024) await page.getByRole("button", { name: /Cart & Checkout|View cart/ }).click();
  return page.viewportSize()!.width < 1024 ? page.getByRole("dialog", { name: "Current sale" }) : page.getByRole("complementary", { name: "Cart" });
}
async function price(page: Page, value: string) {
  const dialog = page.getByRole("dialog", { name: "Edit Price" });
  await dialog.getByLabel("New price").fill(value);
  await dialog.getByRole("button", { name: "Update Price" }).click();
}
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }

test("custom card and cart prices preserve original snapshots and update all unit totals", async ({ page }) => {
  await setup(page);
  const card = page.getByRole("article", { name: "Paracetamol 500mg" });
  for (const [unit, value] of [["tablet", "6.50"], ["strip", "60"], ["box", "600"]]) {
    await card.getByRole("button", { name: unit, exact: true }).click();
    await card.getByRole("button", { name: "Change Price" }).click(); await price(page, value);
    await card.getByRole("button", { name: "Add to Cart" }).click();
  }
  await page.reload();
  const panel = await cart(page);
  await expect(panel).toContainText("666.5");
  await panel.getByRole("button", { name: "Change Price", exact: true }).first().click(); await price(page, "6");
  await panel.getByRole("spinbutton", { name: "Paracetamol tablet in cart", exact: true }).fill("2");
  await expect(panel).toContainText("672");
  let payload: Record<string, unknown> | undefined;
  await page.route("**/api/checkout", async (route) => { payload = route.request().postDataJSON(); await route.fulfill({ status: 201, json: { sale_id: sale.id, invoice_number: "QEI-CUSTOM", net_total: 672, change_amount: 28 } }); });
  await panel.getByRole("button", { name: "Checkout", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "Complete sale" });
  await payment.getByLabel("Cash received").fill("700");
  await expect(payment).toContainText("28"); await noOverflow(page);
  await payment.getByRole("button", { name: "Complete Sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "QEI-CUSTOM" })).toBeVisible();
  expect(payload?.items).toEqual([
    { medicineId: medicine.id, unitKey: "base", quantity: 2, expectedPrice: "7.00", customPrice: "6.00" },
    { medicineId: medicine.id, unitKey: "strip", quantity: 1, expectedPrice: "65.00", customPrice: "60.00" },
    { medicineId: medicine.id, unitKey: "box", quantity: 1, expectedPrice: "620.00", customPrice: "600.00" },
  ]);
  expect(await page.evaluate(() => sessionStorage.getItem("test-print-count"))).toBeNull();
  await page.getByRole("button", { name: "Next sale" }).click();
  await expect(card).toContainText("620"); // Preferred box is retained; its catalogue price is restored.
});

test("card requires external confirmation and auto print runs once after a successful retry", async ({ page }) => {
  await setup(page);
  const card = page.getByRole("article", { name: "Paracetamol 500mg" });
  await card.getByRole("button", { name: "strip", exact: true }).click();
  await card.getByRole("spinbutton").fill("3"); await card.getByRole("button", { name: "Add to Cart" }).click();
  const panel = await cart(page);
  await panel.getByRole("switch", { name: "Auto Print Receipt" }).click();
  await panel.getByLabel("Receipt paper width").selectOption("58");
  await panel.getByRole("button", { name: "Checkout", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "Complete sale" });
  await payment.getByRole("button", { name: "card", exact: true }).click();
  await expect(payment.getByRole("button", { name: "Complete Sale", exact: true })).toBeDisabled();
  await payment.getByRole("checkbox").check();
  let attempts = 0; let first: unknown;
  await page.route("**/api/checkout", async (route) => {
    const payload = route.request().postDataJSON(); attempts++;
    if (attempts === 1) { first = payload; await route.abort(); }
    else { expect(payload).toEqual(first); await route.fulfill({ status: 201, json: { sale_id: sale.id, invoice_number: sale.invoice_number, net_total: 195, change_amount: 0 } }); }
  });
  await payment.getByRole("button", { name: "Complete Sale", exact: true }).click();
  await expect(payment.getByRole("button", { name: "Retry Sale", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem("test-print-count"))).toBeNull();
  await payment.getByRole("button", { name: "Retry Sale", exact: true }).click();
  await expect(page).toHaveURL(/print=thermal&width=58/);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("test-print-count"))).toBe("1");
  expect(first).toMatchObject({ paymentMethod: "card", tenderedAmount: null, cardConfirmed: true }); expect(attempts).toBe(2);
  await page.reload(); await expect(page.getByText("SALES RECEIPT")).toBeVisible();
  await page.waitForTimeout(600); expect(await page.evaluate(() => sessionStorage.getItem("test-print-count"))).toBe("1");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".no-print").first()).toBeHidden(); await noOverflow(page);
  expect(await page.locator("[data-paper]").evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(205);
  await page.screenshot({ path: "test-results/thermal-58-" + test.info().project.name + ".png", fullPage: true });
  await page.emulateMedia({ media: "screen" }); await page.getByRole("link", { name: "Next sale" }).click();
  const next = await cart(page);
  await expect(next.getByRole("switch", { name: "Auto Print Receipt" })).toBeChecked();
  await expect(next.getByLabel("Receipt paper width")).toHaveValue("58");
  await expect(next).toContainText("0 items");
});

test("Auto Print OFF offers manual receipt printing at 80mm", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Add to Cart" }).click();
  const panel = await cart(page);
  await expect(panel.getByRole("switch", { name: "Auto Print Receipt" })).not.toBeChecked();
  await page.route("**/api/checkout", (route) => route.fulfill({ status: 201, json: { sale_id: sale.id, invoice_number: sale.invoice_number, net_total: 7, change_amount: 0 } }));
  await panel.getByRole("button", { name: "Checkout", exact: true }).click();
  await page.getByRole("button", { name: "Exact amount" }).click(); await page.getByRole("button", { name: "Complete Sale", exact: true }).click();
  await expect(page.getByRole("link", { name: "Print receipt" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("test-print-count"))).toBeNull();
  await page.getByRole("link", { name: "Print receipt" }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("test-print-count"))).toBe("1");
  await expect(page.locator("[data-paper]")).toHaveAttribute("data-paper", "80mm");
  await expect(page.locator("article")).toContainText("3 strip");
  await expect(page.locator("article")).toContainText("cash"); await noOverflow(page);
  await page.getByRole("button", { name: "Print invoice" }).click();
  expect(await page.evaluate(() => sessionStorage.getItem("test-print-count"))).toBe("2");
});

for (const role of ["owner", "salesperson"]) test(role + " requests a POS refund at original discounted prices", async ({ page }) => {
  await setup(page, role);
  let requested = false, approved = false; const calls: unknown[] = [];
  await page.route("**/api/returns/invoice?**", (route) => route.fulfill({ json: [{ ...sale, net_total: 180, sale_items: [{ ...saleItem, net_line_total: 180 }], sale_returns: requested ? [{ id: "return-new", status: approved ? "approved" : "requested", return_items: [{ id: "line-new", sale_item_id: saleItem.id, quantity: 2, approved_quantity: approved ? 2 : null }] }] : [] }] }));
  await page.route("**/__test/return", async (route) => { calls.push(route.request().postDataJSON()); requested = true; await route.fulfill({ json: { ok: true, id: "return-new" } }); });
  await page.route("**/__test/review", async (route) => { calls.push(route.request().postDataJSON()); approved = true; await route.fulfill({ json: { ok: true, refund: 120 } }); });
  const panel = await cart(page); await panel.getByRole("button", { name: "Return / Refund" }).click();
  const dialog = page.getByRole("dialog", { name: "Return / Refund", exact: true });
  await dialog.getByLabel("Invoice number").fill("QEI-TEST"); await dialog.getByRole("button", { name: "Find", exact: true }).click();
  await dialog.getByLabel("Return quantity for Paracetamol strip").fill("2"); await dialog.getByLabel("Reason for return").fill("Unopened medicine");
  await expect(dialog.getByText("Estimated refund").locator("..")).toContainText("120"); await noOverflow(page);
  await dialog.getByRole("button", { name: "Send Return Request" }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toMatchObject({ saleId: sale.id, reason: "Unopened medicine", items: [{ sale_item_id: saleItem.id, quantity: 2 }] });
  if (role === "owner") {
    await dialog.getByRole("button", { name: "Review", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Review return" });
    await review.getByRole("checkbox").check(); await review.getByRole("button", { name: "Approve Refund" }).click();
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1]).toMatchObject({ returnId: "return-new", approve: true, items: [{ return_item_id: "line-new", approved_quantity: 2, restockable: true }] });
    await expect(dialog.getByRole("button", { name: "Review", exact: true })).toHaveCount(0);
  } else await expect(dialog.getByRole("button", { name: "Review", exact: true })).toHaveCount(0);
});

test("server discount rejection unlocks the cart for a corrected price", async ({ page }) => {
  await setup(page, "salesperson"); await page.getByRole("button", { name: "Add to Cart" }).click();
  const panel = await cart(page); await panel.getByRole("button", { name: "Change Price" }).click(); await price(page, "1");
  await page.route("**/api/checkout", (route) => route.fulfill({ status: 403, json: { error: "Discount exceeds the salesperson limit." } }));
  await panel.getByRole("button", { name: "Checkout", exact: true }).click();
  await page.getByRole("button", { name: "Exact amount" }).click(); await page.getByRole("button", { name: "Complete Sale", exact: true }).click();
  await expect(page.getByText("Discount exceeds the salesperson limit.")).toBeVisible();
  await page.getByRole("button", { name: "Close payment" }).click();
  const corrected = await cart(page); await expect(corrected.getByRole("button", { name: "Change Price" })).toBeEnabled();
});

test("an interrupted checkout keeps its retry key through a later session denial", async ({ page }) => {
  await setup(page); await page.getByRole("button", { name: "Add to Cart" }).click();
  const panel = await cart(page); await panel.getByRole("button", { name: "Checkout", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "Complete sale" });
  const requests: unknown[] = [];
  await page.route("**/api/checkout", async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) await route.abort();
    else if (requests.length === 2) await route.fulfill({ status: 403, json: { error: "The sale could not be confirmed. Retry this sale to check its status." } });
    else await route.fulfill({ status: 201, json: { sale_id: sale.id, invoice_number: "QEI-RECOVERED", net_total: 7, change_amount: 0 } });
  });
  await payment.getByRole("button", { name: "Exact amount" }).click();
  await payment.getByRole("button", { name: "Complete Sale", exact: true }).click();
  await payment.getByRole("button", { name: "Retry Sale", exact: true }).click();
  await expect(payment.getByRole("heading", { name: "Confirm sale status" })).toBeVisible();
  await payment.getByRole("button", { name: "Retry Sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "QEI-RECOVERED" })).toBeVisible();
  expect(requests).toHaveLength(3); expect(requests[1]).toEqual(requests[0]); expect(requests[2]).toEqual(requests[0]);
});
