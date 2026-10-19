import { expect, test, type Page } from "@playwright/test";
import { medicine, sale, saleItem, returnSale } from "../ui/data";

async function setup(page: Page, role = "owner") {
  await page.route("**/api/medicines/search?**", (route) => route.fulfill({ json: [medicine] }));
  await page.addInitScript(() => { window.print = () => sessionStorage.setItem("test-print-count", String(Number(sessionStorage.getItem("test-print-count") ?? 0) + 1)); });
  await page.goto("/?flow=pos&shell=1&role=" + role);
}
async function cart(page: Page) {
  if (page.viewportSize()!.width < 1024) await page.getByRole("button", { name: /Cart & Checkout|View cart/ }).click();
  return page.viewportSize()!.width < 1024 ? page.getByRole("dialog", { name: "Current sale" }) : page.getByRole("complementary", { name: "Cart" });
}
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }

test("Inventory prices, inline discounts and extra charges reconcile at cash checkout", async ({ page }) => {
  await setup(page);
  const card = page.getByRole("article", { name: "Paracetamol 500mg" });
  await expect(page.getByRole("button", { name: "Change Price" })).toHaveCount(0);
  await card.getByRole("button", { name: "strip", exact: true }).click();
  await card.getByRole("spinbutton").fill("3");
  await card.getByRole("button", { name: "Add to Cart" }).click();
  let panel = await cart(page);
  await panel.getByText("Individual medicine discounts", { exact: true }).click();
  await panel.getByLabel("Paracetamol strip discount (Rs.)", { exact: true }).fill("15");
  await panel.getByRole("group", { name: "Bill discount type", exact: true }).getByRole("button", { name: "Percentage (%)" }).click();
  await panel.getByLabel("Bill discount (%)", { exact: true }).fill("10");
  await panel.getByText("+ Extra Charges", { exact: true }).click();
  await panel.getByLabel("Description (optional)").fill("Delivery");
  await panel.getByLabel("Extra Amount (Rs.)").fill("30");
  await expect(panel).toContainText("192");
  await page.reload(); panel = await cart(page);
  await expect(panel.getByLabel("Bill discount (%)", { exact: true })).toHaveValue("10");
  await expect(panel.getByLabel("Extra Amount (Rs.)")).toHaveValue("30");
  let payload: Record<string, unknown> | undefined;
  await page.route("**/api/checkout", async route => { payload = route.request().postDataJSON(); await route.fulfill({status:201,json:{sale_id:sale.id,invoice_number:"QEI-DISCOUNT",net_total:192,change_amount:8}}); });
  await panel.getByRole("button", { name: "Checkout", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "Complete sale" });
  await expect(payment).toContainText("Delivery");
  await payment.getByLabel("Cash received").fill("200");
  await expect(payment).toContainText("8");
  await noOverflow(page);
  await payment.getByRole("button", { name: "Complete Sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "QEI-DISCOUNT" })).toBeVisible();
  expect(payload).toMatchObject({items:[{medicineId:medicine.id,unitKey:"strip",quantity:3,expectedPrice:"65.00",lineDiscount:15}],discount:18,extraAmount:30,extraDescription:"Delivery"});
  expect((payload?.items as Record<string,unknown>[])[0]).not.toHaveProperty("customPrice");
});

test("fixed discounts and extra charges can be edited and removed", async ({ page }) => {
 await setup(page); await page.getByRole("button",{name:"Add to Cart"}).click();
 const panel=await cart(page);
 await panel.getByLabel("Bill discount (Rs.)",{exact:true}).fill("2");
 await expect(panel).toContainText("5");
 await panel.getByRole("button",{name:"Remove bill discount",exact:true}).click();
 await expect(panel.getByLabel("Bill discount (Rs.)",{exact:true})).toHaveValue("0");
 await panel.getByText("+ Extra Charges",{exact:true}).click();
 await panel.getByLabel("Extra Amount (Rs.)").fill("3");
 await expect(panel).toContainText("10");
 await panel.getByRole("button",{name:"Remove extra charge",exact:true}).click();
 await expect(panel.getByLabel("Extra Amount (Rs.)")).toHaveValue("0");
 await noOverflow(page);
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

for (const role of ["owner", "salesperson"]) test(role + " completes a POS refund immediately at original discounted prices", async ({ page }) => {
  await setup(page, role);
  const calls: Record<string, unknown>[] = [];
  await page.route("**/api/returns/invoice?**", (route) => route.fulfill({ json: { sales: [returnSale], hasMore: false } }));
  await page.route("**/__test/complete-return", async (route) => { calls.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true, id: "return-new", returnNumber: "RET-INSTANT", refund: 120 } }); });
  const panel = await cart(page); await panel.getByRole("button", { name: "Return / Refund" }).click();
  const dialog = page.getByRole("dialog", { name: "Return / Refund", exact: true });
  await dialog.getByRole("button", { name: /QEI-TEST-0001/ }).click();
  await dialog.getByLabel("Return quantity for Paracetamol strip").fill("2");
  await dialog.getByLabel("Reason for return").fill("Unopened medicine");
  await dialog.getByRole("checkbox").check();
  await expect(dialog.getByText("Refund amount").locator("..")).toContainText("120"); await noOverflow(page);
  await dialog.getByRole("button", { name: "Complete Return", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Return completed" })).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ saleId: sale.id, reason: "Unopened medicine", items: [{ sale_item_id: saleItem.id, quantity: 2, restockable: true }] });
  await expect(dialog.getByRole("button", { name: "Review", exact: true })).toHaveCount(0);
});

test("server discount rejection unlocks the cart for a corrected discount", async ({ page }) => {
  await setup(page, "salesperson"); await page.getByRole("button", { name: "Add to Cart" }).click();
  const panel = await cart(page); await panel.getByLabel("Bill discount (Rs.)", { exact: true }).fill("1");
  await page.route("**/api/checkout", (route) => route.fulfill({ status: 403, json: { error: "Discount exceeds the salesperson limit." } }));
  await panel.getByRole("button", { name: "Checkout", exact: true }).click();
  await page.getByRole("button", { name: "Exact amount" }).click(); await page.getByRole("button", { name: "Complete Sale", exact: true }).click();
  await expect(page.getByText("Discount exceeds the salesperson limit.")).toBeVisible();
  await page.getByRole("button", { name: "Close payment" }).click();
  const corrected = await cart(page); await expect(corrected.getByLabel("Bill discount (Rs.)", { exact: true })).toBeEnabled();
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
