import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { medicine } from "../ui/data";
import { formatCurrency } from "@/lib/utils";

async function openCart(page: Page, count: number) {
  await page.route("**/api/medicines/search?**", route => route.fulfill({ json: [medicine] }));
  await page.addInitScript(({ count, medicine }) => {
    sessionStorage.setItem("qeilvra-cart-v2-fixture", JSON.stringify({
      cart: Array.from({ length: count }, (_, index) => ({ ...medicine,
        id: "medicine-" + index,
        name: index === 0 ? "Medicine with a long readable name for checking wrapping" : "Medicine " + (index + 1),
        quantity: 1, unit: medicine.units[index % 3], lineKey: "medicine-" + index,
      })), discount: "0", discountMode: "fixed", extraAmount: "0", extraDescription: "",
    }));
  }, { count, medicine });
  await page.goto("/pos?shell=1");
  if (page.viewportSize()!.width < 1024) await page.getByRole("button", { name: /Cart & Checkout|View cart/ }).click();
  const panel = page.viewportSize()!.width < 1024 ? page.getByRole("dialog", { name: "Current sale" }) : page.getByRole("complementary", { name: "Cart", exact: true });
  await expect(panel.getByRole("heading", { name: `Cart (${count} ${count === 1 ? "item" : "items"})`, exact: true })).toBeVisible();
  return panel;
}

async function setExpanded(panel: Locator, discount: boolean, extra: boolean) {
  for (const [selector, open] of [[".pos-bill-discount", discount], [".pos-bill-extra", extra]] as const) {
    const details = panel.locator(selector);
    if (await details.evaluate(element => (element as HTMLDetailsElement).open) !== open) await details.locator("summary").click();
    await expect(details).toHaveJSProperty("open", open);
  }
}

async function assertBillingLayout(page: Page, panel: Locator, count: number) {
  const geometry = await panel.evaluate(element => {
    const bounds = (target: Element) => { const r = target.getBoundingClientRect(); return { y: r.y, bottom: r.bottom, height: r.height }; };
    const summary = element.querySelector(".pos-cart-summary")!;
    const checkout = [...summary.querySelectorAll("button")].find(button => button.textContent?.trim() === "Checkout")!;
    const refund = [...summary.querySelectorAll("button")].find(button => button.textContent?.trim() === "Return / Refund")!;
    return { height: innerHeight, frameHeight: element.clientHeight, header: bounds(element.querySelector(".pos-cart-header")!), items: bounds(element.querySelector(".pos-cart-items")!), summary: bounds(summary),
      discount: bounds(summary.querySelector(".pos-bill-discount")!), extra: bounds(summary.querySelector(".pos-bill-extra")!), checkout: bounds(checkout), refund: bounds(refund),
      overflow: document.documentElement.scrollWidth > innerWidth,
      scrollers: [element, ...element.querySelectorAll<HTMLElement>("*")].filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1).map(e => e.classList.contains("pos-cart-items") ? "items" : e.classList.contains("pos-cart") ? "cart" : e.tagName),
    };
  });
  expect(geometry.overflow).toBe(false);
  expect(geometry.extra.y).toBeGreaterThanOrEqual(geometry.discount.bottom - 1);
  expect(geometry.checkout.y).toBeGreaterThanOrEqual(geometry.extra.bottom - 1);
  expect(geometry.refund.y).toBeGreaterThanOrEqual(geometry.checkout.bottom - 1);
  const canAnchor = geometry.header.height + geometry.summary.height + 104 <= geometry.frameHeight + 1;
  if (geometry.height >= 800 && canAnchor) {
    expect(geometry.items.bottom).toBeLessThanOrEqual(geometry.summary.y + 1);
    expect(geometry.summary.bottom).toBeLessThanOrEqual(geometry.height + 1);
    expect(geometry.scrollers.every(name => name === "items")).toBe(true);
    if (count === 20) expect(geometry.scrollers).toEqual(["items"]);
    const before = await panel.locator(".pos-cart-summary").boundingBox();
    await panel.getByRole("region", { name: "Cart medicines" }).evaluate(e => { e.scrollTop = e.scrollHeight; });
    expect(await panel.locator(".pos-cart-summary").boundingBox()).toEqual(before);
    await expect(panel.locator(".pos-bill-discount > summary")).toBeInViewport({ ratio: 1 });
    await expect(panel.locator(".pos-bill-extra > summary")).toBeInViewport({ ratio: 1 });
  } else {
    // Short windows may scroll the complete cart; essential actions keep their
    // natural height and remain reachable in their expected order.
    expect(geometry.checkout.height).toBeGreaterThanOrEqual(44);
    expect(geometry.refund.height).toBeGreaterThanOrEqual(44);
  }
  const checkout = panel.getByRole("button", { name: "Checkout", exact: true });
  await checkout.scrollIntoViewIfNeeded();
  await expect(checkout).toBeInViewport({ ratio: 1 });
  if (count) await expect(checkout).toBeEnabled(); else await expect(checkout).toBeDisabled();
  const refund = panel.getByRole("button", { name: "Return / Refund", exact: true });
  await refund.scrollIntoViewIfNeeded();
  await expect(refund).toBeInViewport({ ratio: 1 });
  await expect(refund).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

// Effective CSS viewport and DPR reproduce layout zoom. DPR alone or pinch
// zoom would leave CSS breakpoints unchanged.
for (const zoom of [1, 1.25, 1.5, 2]) for (const count of [0, 1, 5, 20]) {
  test(`${count} cart medicines at ${zoom * 100}% zoom-equivalent sizing`, async ({ browser, baseURL }, testInfo) => {
    const physical = testInfo.project.use.viewport!;
    test.skip(zoom > 1 && physical.width < 1024, "Browser layout zoom is exercised on laptop and desktop; all nine widths run at 100%.");
    const context = await browser.newContext({ baseURL, viewport: { width: Math.max(320, Math.floor(physical.width / zoom)), height: Math.floor(physical.height / zoom) }, deviceScaleFactor: zoom, hasTouch: physical.width < 1024 });
    try {
      const page = await context.newPage();
      const panel = await openCart(page, count);
      await expect(panel.locator(".pos-bill-discount")).toHaveJSProperty("open", false);
      await expect(panel.locator(".pos-bill-extra")).toHaveJSProperty("open", false);
      await expect(panel.getByLabel("Bill discount (Rs.)", { exact: true })).toBeHidden();
      await expect(panel.getByLabel("Extra Amount (Rs.)")).toBeHidden();
      for (const [discount, extra] of [[false, false], [true, false], [false, true], [true, true]] as const) {
        await setExpanded(panel, discount, extra);
        await assertBillingLayout(page, panel, count);
      }
      await panel.getByRole("combobox", { name: "Bill discount type", exact: true }).selectOption("percent");
      await panel.getByLabel("Bill discount (%)", { exact: true }).fill("10");
      await panel.getByLabel("Description (optional)").fill("Delivery");
      await panel.getByLabel("Extra Amount (Rs.)").fill("30");
      await setExpanded(panel, false, false);
      await expect(panel.locator(".pos-bill-extra > summary")).toContainText("30");
      const subtotal = Array.from({ length: count }, (_, index) => medicine.units[index % 3].selling_price).reduce((sum, price) => sum + price, 0);
      await expect(panel.locator(".pos-bill-discount > summary")).toContainText(formatCurrency(subtotal * 0.1));
      await expect(panel.locator(".pos-final-total")).toContainText(formatCurrency(subtotal * 0.9 + 30));
      await setExpanded(panel, true, true);
      await expect(panel.getByLabel("Bill discount (%)", { exact: true })).toHaveValue("10");
      await expect(panel.getByLabel("Extra Amount (Rs.)")).toHaveValue("30");
      await expect(panel.getByLabel("Description (optional)")).toHaveValue("Delivery");
      await panel.getByRole("button", { name: "Remove extra charge", exact: true }).click();
      await expect(panel.getByLabel("Description (optional)")).toHaveValue("");
      await expect(panel.getByLabel("Extra Amount (Rs.)")).toHaveValue("0");
      await panel.getByRole("button", { name: "Remove bill discount", exact: true }).click();
      await expect(panel.getByLabel("Bill discount (%)", { exact: true })).toHaveValue("0");
      if (zoom === 1 && [0, 20].includes(count)) {
        await setExpanded(panel, false, false);
        await page.screenshot({ path: `test-results/pos-cart-${count}-${testInfo.project.name}.png` });
      }
    } finally { await context.close(); }
  });
}

test("billing disclosures support keyboard, focus and touch targets", async ({ page }, testInfo) => {
  const panel = await openCart(page, 5);
  const discount = panel.locator(".pos-bill-discount"), extra = panel.locator(".pos-bill-extra");
  await discount.locator("summary").focus();
  await expect(discount.locator("summary")).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await discount.locator("summary").evaluate(element => element.matches(":focus-visible"))).toBe(true);
  await expect(discount).toHaveJSProperty("open", true);
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("combobox", { name: "Bill discount type", exact: true })).toBeFocused();
  await discount.locator("summary").focus();
  await page.keyboard.press("Space");
  await expect(discount).toHaveJSProperty("open", false);
  if (testInfo.project.use.hasTouch) await extra.locator("summary").tap(); else await extra.locator("summary").click();
  await expect(extra).toHaveJSProperty("open", true);
  const targets = panel.locator(".pos-bill-discount > summary, .pos-bill-extra > summary, .pos-cart-summary button, .pos-cart-summary select");
  for (const target of await targets.all()) if (await target.isVisible()) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await panel.getByRole("button", { name: "Return / Refund", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Return / Refund", exact: true })).toBeVisible();
});

async function shortWindow(browser: Browser, baseURL: string | undefined, width: number, height: number) {
  const context = await browser.newContext({ baseURL, viewport: { width, height }, hasTouch: width < 1024 });
  try {
    const page = await context.newPage(); const panel = await openCart(page, 20);
    await setExpanded(panel, true, true);
    await panel.getByLabel("Description (optional)").fill("Short-screen service");
    await panel.getByLabel("Extra Amount (Rs.)").fill("5");
    await assertBillingLayout(page, panel, 20);
    await panel.getByRole("button", { name: "Checkout", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Complete sale" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/cart-payment-${width}x${height}.png` });
  } finally { await context.close(); }
}

for (const [width, height] of [[1366, 768], [1024, 600], [1024, 450], [844, 390], [568, 320], [320, 568]]) test(`${width}x${height} windows keep billing and checkout operable`, async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "width-1440", "Additional height cases run once.");
  await shortWindow(browser, baseURL, width, height);
});

test("laptop POS starts compact and honors the employee sidebar preference", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "width-1024", "Laptop default is checked at its supported width.");
  await openCart(page, 0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  const sidebar = page.locator("#desktop-sidebar");
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(80);
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(224);
  await page.reload();
  await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible();
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(224);
});