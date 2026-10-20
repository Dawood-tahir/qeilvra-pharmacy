import { expect, test, type Browser, type Page } from "@playwright/test";
import { medicine } from "../ui/data";

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

// CSS viewport size and DPR reproduce the layout and physical sizing of browser
// zoom, rather than pinch zoom, which would leave CSS breakpoints unchanged.
for (const zoom of [1, 1.25, 1.5]) for (const count of [0, 1, 5, 20]) {
  test(`${count} cart medicines at ${zoom * 100}% zoom-equivalent sizing`, async ({ browser, baseURL }, testInfo) => {
    const physical = testInfo.project.use.viewport!;
    const context = await browser.newContext({ baseURL, viewport: { width: Math.floor(physical.width / zoom), height: Math.floor(physical.height / zoom) }, deviceScaleFactor: zoom, hasTouch: physical.width < 1024 });
    try {
      const page = await context.newPage();
      const panel = await openCart(page, count);
      const geometry = await panel.evaluate(element => {
        const bounds = (selector: string) => { const r = element.querySelector(selector)!.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        return { width: innerWidth, height: innerHeight, cartWidth: bounds(".pos-cart").width, items: bounds(".pos-cart-items"), billing: bounds(".pos-billing-controls"), summary: bounds(".pos-cart-summary"), discount: bounds(".pos-bill-discount"), extra: bounds(".pos-bill-extra"), overflow: document.documentElement.scrollWidth > innerWidth,
          scrollers: [element, ...element.querySelectorAll<HTMLElement>("*")].filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1).map(e => e.classList.contains("pos-cart-items") ? "items" : e.tagName),
        };
      });
      expect(geometry.overflow).toBe(false);
      if (geometry.width >= 640 && geometry.cartWidth >= 380) {
        expect(Math.abs(geometry.discount.y - geometry.extra.y)).toBeLessThan(2);
        expect(geometry.discount.right).toBeLessThan(geometry.extra.x);
        expect(Math.abs(geometry.discount.width - geometry.extra.width)).toBeLessThan(20);
      } else expect(geometry.extra.y).toBeGreaterThanOrEqual(geometry.discount.bottom);
      const checkout = panel.getByRole("button", { name: "Checkout", exact: true });
      if (geometry.height > 700) {
        expect(geometry.items.bottom).toBeLessThanOrEqual(geometry.billing.y + 1);
        expect(geometry.billing.bottom).toBeLessThanOrEqual(geometry.summary.y + 1);
        expect(geometry.summary.bottom).toBeLessThanOrEqual(geometry.height + 1);
        expect(geometry.scrollers.every(name => name === "items")).toBe(true);
        if (count === 20) expect(geometry.scrollers).toEqual(["items"]);
        const before = await panel.locator(".pos-cart-summary").boundingBox();
        await panel.getByRole("region", { name: "Cart medicines" }).evaluate(e => { e.scrollTop = e.scrollHeight; });
        expect(await panel.locator(".pos-cart-summary").boundingBox()).toEqual(before);
      } else expect(geometry.scrollers).not.toContain("items");
      if (geometry.height <= 420) await checkout.scrollIntoViewIfNeeded();
      await expect(checkout).toBeInViewport({ ratio: 1 });
      await expect(checkout).toBeVisible();
      if (count) await expect(checkout).toBeEnabled();
      else await expect(checkout).toBeDisabled();
      await expect(panel.getByRole("button", { name: "Return / Refund", exact: true })).toBeVisible();
      // The two billing controls must be directly operable, including short
      // windows where a single outer scroll is deliberately necessary.
      await panel.getByRole("combobox", { name: "Bill discount type", exact: true }).selectOption("percent");
      await panel.getByLabel("Bill discount (%)", { exact: true }).fill("10");
      await panel.getByLabel("Description (optional)").fill("Delivery");
      await panel.getByLabel("Extra Amount (Rs.)").fill("30");
      await panel.getByRole("button", { name: "Remove extra charge", exact: true }).click();
      await expect(panel.getByLabel("Description (optional)")).toHaveValue("");
      await expect(panel.getByLabel("Extra Amount (Rs.)")).toHaveValue("0");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await context.close(); }
  });
}

async function shortWindow(browser: Browser, baseURL: string | undefined, width: number, height: number) {
  const context = await browser.newContext({ baseURL, viewport: { width, height } });
  try {
    const page = await context.newPage(); const panel = await openCart(page, 20);
    await panel.getByLabel("Description (optional)").fill("Short-screen service");
    await panel.getByLabel("Extra Amount (Rs.)").fill("5");
    const checkout = panel.getByRole("button", { name: "Checkout", exact: true });
    await checkout.click();
    await expect(page.getByRole("dialog", { name: "Complete sale" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/cart-payment-${width}x${height}.png` });
  } finally { await context.close(); }
}

test("laptop and very short windows keep billing and checkout operable", async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "width-1440", "Additional height cases run once.");
  for (const [width, height] of [[1366, 768], [1024, 450], [568, 320], [320, 568]]) await shortWindow(browser, baseURL, width, height);
});
