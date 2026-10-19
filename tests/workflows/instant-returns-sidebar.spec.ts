import { expect, test, type Page } from "@playwright/test";
import { medicine, returnSale } from "../ui/data";
import { localDateISO } from "@/lib/utils";

async function openReturns(page: Page, role = "owner") {
  await page.route("**/api/medicines/search?**", route => route.fulfill({ json: [medicine] }));
  await page.goto("/pos?shell=1&role=" + role);
  if (page.viewportSize()!.width < 1024) await page.getByRole("button", { name: /Cart & Checkout|View cart/ }).click();
  await page.getByRole("button", { name: "Return / Refund", exact: true }).click();
  return page.getByRole("dialog", { name: "Return / Refund", exact: true });
}
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

test("failed loading shows Retry without a successful page indicator", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/returns/invoice?**", route => ++calls === 1 ? route.fulfill({ status: 503, json: { error: "Could not load sales. Try again." } }) : route.fulfill({ json: { sales: [returnSale], hasMore: false } }));
  const dialog = await openReturns(page);
  await expect(dialog.getByRole("alert")).toContainText("Could not load sales");
  await expect(dialog.getByText("Page 1", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Loading recent sales...")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /QEI-TEST-0001/ })).toBeVisible();
  await noOverflow(page);
});

test("single tablets from an original strip use the original discounted pack price", async ({ page }) => {
  let request: Record<string, unknown> | undefined;
  await page.route("**/api/returns/invoice?**", route => route.fulfill({ json: { sales: [returnSale], hasMore: false } }));
  await page.route("**/__test/complete-return", route => { request = route.request().postDataJSON(); return route.fulfill({ json: { ok: true, id: "return-tablet", returnNumber: "RET-TABLET", refund: 6 } }); });
  const dialog = await openReturns(page, "salesperson");
  await dialog.getByRole("button", { name: /QEI-TEST-0001/ }).click();
  await dialog.getByLabel("Return unit for Paracetamol strip").selectOption("base");
  await dialog.getByLabel("Return quantity for Paracetamol strip").fill("1");
  await dialog.getByLabel("Reason for return").fill("One unopened tablet");
  await expect(dialog.getByText("Refund amount").locator("..")).toContainText("6");
  await dialog.getByRole("button", { name: "Complete Return", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Return completed" })).toBeVisible();
  expect(request).toMatchObject({ items: [{ quantity: 1, in_base_units: true, restockable: false }] });
  await noOverflow(page);
});

test("recent sales load automatically and search accepts medicine names, dates and pagination", async ({ page }) => {
  const lookups: URL[] = [];
  await page.route("**/api/returns/invoice?**", route => {
    const url = new URL(route.request().url()); lookups.push(url);
    return route.fulfill({ json: { sales: [returnSale], hasMore: url.searchParams.get("page") !== "2" } });
  });
  const dialog = await openReturns(page);
  await expect(dialog.getByRole("button", { name: /QEI-TEST-0001/ })).toBeVisible();
  expect(lookups[0].searchParams.get("q")).toBe("");
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog.getByText("Page 2", { exact: true })).toBeVisible();
  await dialog.getByLabel("Invoice or medicine").fill("Paracetamol");
  await dialog.getByLabel("Sale date").fill(localDateISO());
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect.poll(() => lookups.at(-1)?.searchParams.get("date")).toBe(localDateISO());
  expect(lookups.at(-1)?.searchParams.get("q")).toBe("Paracetamol");
  await noOverflow(page);
});

test("an uncertain refund survives refresh and retries exactly once with the same key", async ({ page }) => {
  const calls: Record<string, unknown>[] = [];
  await page.route("**/api/returns/invoice?**", route => route.fulfill({ json: { sales: [returnSale], hasMore: false } }));
  await page.route("**/__test/complete-return", async route => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({ json: calls.length === 1 ? { ok: false, uncertain: true, error: "The return could not be confirmed." } : { ok: true, id: "return", returnNumber: "RET-RETRY", refund: 60 } });
  });
  let dialog = await openReturns(page, "salesperson");
  await dialog.getByRole("button", { name: /QEI-TEST-0001/ }).click();
  await dialog.getByLabel("Return quantity for Paracetamol strip").fill("1");
  await dialog.getByLabel("Reason for return").fill("One returned strip");
  await dialog.getByRole("button", { name: "Complete Return", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Retry Return" })).toBeVisible();
  await expect(dialog.getByLabel("Reason for return")).toBeDisabled();
  await page.reload();
  if (page.viewportSize()!.width < 1024) await page.getByRole("button", { name: /Cart & Checkout|View cart/ }).click();
  await page.getByRole("button", { name: "Return / Refund", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Return / Refund", exact: true });
  await expect(dialog.getByRole("button", { name: "Retry Return" })).toBeVisible();
  await dialog.getByRole("button", { name: "Retry Return" }).click();
  await expect(dialog.getByRole("heading", { name: "Return completed" })).toBeVisible();
  expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
  await noOverflow(page);
});

test("manual card refunds require confirmation and unsuitable stock stays unchecked", async ({ page }) => {
  const calls: Record<string, unknown>[] = [];
  await page.route("**/api/returns/invoice?**", route => route.fulfill({ json: { sales: [returnSale], hasMore: false } }));
  await page.route("**/__test/complete-return", async route => { calls.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true, id: "return", returnNumber: "RET-CARD", refund: 120 } }); });
  const dialog = await openReturns(page);
  await dialog.getByRole("button", { name: /QEI-TEST-0001/ }).click();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await dialog.getByLabel("Return quantity for Paracetamol strip").fill("2");
  await dialog.getByLabel("Reason for return").fill("Opened strips returned");
  await dialog.getByRole("combobox", { name: "Refund method" }).selectOption("card");
  await dialog.getByRole("button", { name: "Complete Return", exact: true }).click();
  expect(calls).toHaveLength(0);
  await dialog.getByRole("checkbox", { name: /I have completed/ }).check();
  await dialog.getByRole("button", { name: "Complete Return", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Return completed" })).toBeVisible();
  expect(calls[0]).toMatchObject({ paymentMethod: "card", cardConfirmed: true, items: [{ restockable: false, quantity: 2 }] });
});

for (const role of ["owner", "salesperson"]) test(role + " sidebar toggles without losing role-scoped navigation", async ({ page }) => {
  await page.route("**/__test/inventory?**", route => route.fulfill({ json: [medicine] }));
  await page.goto("/medicines?shell=1&role=" + role);
  // The inventory's normal loading request is unrelated to navigation.
  if (page.viewportSize()!.width >= 1024) {
    const sidebar = page.locator("#desktop-sidebar");
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
    await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(80);
    const inventory = sidebar.getByRole("link", { name: "Inventory", exact: true });
    await expect(inventory).toHaveAttribute("title", "Inventory");
    await expect(inventory).toHaveAttribute("href", "/medicines");
    await expect(sidebar.getByRole("link", { name: "Suppliers", exact: true })).toHaveCount(role === "owner" ? 1 : 0);
    await page.reload(); await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/sidebar-collapsed-${role}-${test.info().project.name}.png`, fullPage: true });
    await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
    await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(260);
  } else {
    const trigger = page.getByRole("button", { name: "Open navigation menu", exact: true });
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Navigation menu", exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Suppliers", exact: true })).toHaveCount(role === "owner" ? 1 : 0);
    await expect(drawer.getByRole("link", { name: "Inventory", exact: true })).toHaveAttribute("href", "/medicines");
    for (let index = 0; index < 16; index++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => document.activeElement?.closest("dialog")?.getAttribute("aria-label"))).toBe("Navigation menu"); }
    await page.screenshot({ path: `test-results/sidebar-mobile-${role}-${test.info().project.name}.png`, fullPage: true });
    await page.keyboard.press("Escape"); await expect(drawer).toHaveCount(0); await expect(trigger).toBeFocused();
    await trigger.click();
    const link = drawer.getByRole("link", { name: "Inventory", exact: true });
    // Keep this isolated harness page loaded while verifying the link's close handler.
    await link.evaluate(element => element.addEventListener("click", event => event.preventDefault()));
    await link.click(); await expect(drawer).toHaveCount(0);
  }
  await noOverflow(page);
});
