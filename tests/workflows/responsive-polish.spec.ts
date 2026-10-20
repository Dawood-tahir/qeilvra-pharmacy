import { expect, test, type Page } from "@playwright/test";
import { medicine, purchase, sale, suppliers } from "../ui/data";
import { financialFixture } from "../ui/financial-data";
import { financeRange } from "@/lib/financial-analytics";

const screens = [
  ["dashboard", "/dashboard"], ["pos", "/pos"], ["inventory", "/medicines"],
  ["new-medicine", "/medicines/new"], ["restock", "/medicines/restock"],
  ["purchases", "/purchases"], ["new-purchase", "/purchases/new"], ["purchase-detail", "/purchases/" + purchase.id],
  ["invoices", "/sales"], ["invoice-detail", "/sales/" + sale.id], ["returns", "/returns"],
  ["suppliers", "/suppliers"], ["supplier-detail", "/suppliers/" + suppliers[0].id],
  ["expenses", "/expenses"], ["reports", "/reports"], ["stock-history", "/stock?stock=1"],
  ["users", "/users"], ["settings", "/settings"], ["alerts", "/alerts"], ["notifications", "/notifications"],
] as const;

async function fixtureApi(page: Page) {
  await page.route("**/api/medicines/search?**", route => route.fulfill({ json: [medicine] }));
  await page.route("**/__test/inventory?**", route => route.fulfill({ json: [medicine] }));
  await page.route("**/api/reports/analytics?**", route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: financialFixture(financeRange(url.searchParams.get("period") ?? "today", url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined)) });
  });
}
const address = (path: string) => path + (path.includes("?") ? "&" : "?") + "shell=1";
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

for (const [name, path] of screens) test(`${name} remains readable without page overflow`, async ({ page }, testInfo) => {
  const errors: string[] = [];
  const network: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400) network.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  await fixtureApi(page);
  await page.goto(address(path));
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  if (["dashboard", "reports"].includes(name)) {
    // A heading or loading placeholder alone does not prove that a chart rendered.
    await expect(page.locator(".recharts-wrapper svg").first()).toBeVisible();
    await expect(page.locator(".recharts-wrapper").first()).toHaveJSProperty("clientWidth", expect.any(Number));
    expect(await page.locator(".recharts-wrapper").first().evaluate(e => e.clientWidth)).toBeGreaterThan(100);
  }
  if (name === "inventory") await expect(page.getByText("Paracetamol 500mg", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  expect(geometry.document, `${name} page overflow at ${geometry.viewport}px`).toBeLessThanOrEqual(geometry.viewport);
  await page.screenshot({ path: `.private/polish/screens/${name}-${testInfo.project.name}.png`, fullPage: true });
  expect(errors, `${name} browser console`).toEqual([]);
  expect(network, `${name} network failures`).toEqual([]);
});

test("short laptop and 200 percent layout retain important actions", async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "width-1440", "Additional height and zoom cases run once.");
  for (const [width, height, scale] of [[1366, 768, 1], [1024, 600, 1], [720, 450, 2], [512, 384, 2]]) {
    const context = await browser.newContext({ baseURL, viewport: { width, height }, deviceScaleFactor: scale });
    try {
      const page = await context.newPage();
      await fixtureApi(page);
      for (const name of ["dashboard", "pos", "inventory", "new-purchase", "reports", "settings", "suppliers", "stock-history"]) {
        const path = screens.find(screen => screen[0] === name)![1];
        await page.goto(address(path));
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        if (name === "pos") {
          if (width < 1024) await page.getByRole("button", { name: /Cart & Checkout|View cart/ }).click();
          const checkout = page.getByRole("button", { name: "Checkout", exact: true }).filter({ visible: true });
          await checkout.scrollIntoViewIfNeeded();
          await expect(checkout).toBeInViewport({ ratio: 1 });
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
        await page.screenshot({ path: `.private/polish/screens/${name}-${width}x${height}-scale${scale}.png`, fullPage: true });
      }
    } finally { await context.close(); }
  }
});

test("reduced motion and transparency retain opaque readable surfaces", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "width-1440", "Browser preference assertions run once.");
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-reduced-transparency", value: "reduce" }] });
  await fixtureApi(page);
  await page.goto("/dashboard?shell=1");
  await expect(page.locator(".recharts-wrapper svg").first()).toBeVisible();
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches)).toBe(true);
  const surfaces = await page.locator(".q-glass-primary, .q-topbar").evaluateAll(elements => elements.map(element => ({ background: getComputedStyle(element).backgroundColor, blur: getComputedStyle(element).backdropFilter })));
  expect(surfaces.length).toBeGreaterThan(0);
  for (const surface of surfaces) { expect(surface.blur).toBe("none"); expect(surface.background).not.toContain("rgba"); }
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  await noOverflow(page);
});
