import { expect, test, type Page } from "@playwright/test";
import { suppliers } from "../ui/data";

const newId = "41000000-0000-4000-8000-000000000004";
async function start(page: Page, extra = "") {
  await page.route("**/api/medicines/search?**", (route) => route.fulfill({ json: [] }));
  await page.goto("/medicines/new?shell=1" + extra);
  await expect(page.getByRole("combobox", { name: /Purchased From/ })).toHaveCount(0);
  await page.getByLabel("Medicine Name").fill("Supplier test medicine");
  await page.getByLabel("Strength").fill("500mg");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Step 2 of 3")).toBeVisible();
}
async function stock(page: Page) {
  await page.getByRole("button", { name: "Boxes", exact: true }).click();
  await page.getByLabel("How many did you buy?").fill("2");
  await page.getByLabel("How many tablets are in one strip?").fill("10");
  await page.getByLabel("How many strips are in one box?").fill("10");
  await page.getByLabel("Batch number").fill("NEW-SUPPLIER-BATCH");
  await page.getByLabel("Expiry date").fill("2099-12-25");
  await page.getByLabel("Total purchase cost").fill("400");
  await expect(page.getByText("Total stock: 200 tablets")).toBeVisible();
}
async function prices(page: Page) {
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Step 3 of 3")).toBeVisible();
  await page.getByRole("textbox", { name: /^Price of 1 Tablet/ }).fill("7");
  await expect(page.getByRole("textbox", { name: /^Price of 1 Strip/ })).toHaveValue("70.00");
  await page.getByRole("textbox", { name: /^Price of 1 Strip/ }).fill("65");
  await page.getByRole("textbox", { name: /^Price of 1 Box/ }).fill("620");
}
async function selectSupplier(page: Page) {
  const picker = page.getByRole("combobox", { name: /Purchased From \(Supplier\)/ });
  await picker.fill("city");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("option", { name: suppliers[0].name }).click();
  await expect(picker).toHaveValue(suppliers[0].name);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("new medicine selects a saved supplier in Stock, reviews it, and saves only its ID with the receipt", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/__test/save", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true, id: newId, quantity: 200 } });
  });
  await start(page);
  await selectSupplier(page);
  await stock(page);
  await noOverflow(page);
  await page.screenshot({ path: `test-results/new-medicine-supplier-stock-${test.info().project.name}.png`, fullPage: true });
  await prices(page);
  const review = page.getByRole("region", { name: "Medicine review" });
  await expect(review).toContainText("Purchased from: " + suppliers[0].name);
  await expect(review).toContainText("NEW-SUPPLIER-BATCH");
  await expect(review).toContainText("400");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("combobox", { name: /Purchased From/ })).toHaveValue(suppliers[0].name);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await noOverflow(page);
  await page.screenshot({ path: `test-results/new-medicine-supplier-review-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Save Medicine", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Medicine added successfully." })).toBeVisible();
  await expect(page.getByText("200 tablets are now available.")).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].id).toBeNull();
  expect(requests[0].stock).toMatchObject({ supplier_id: suppliers[0].id, unit_key: "box", quantity: 2, batch_number: "NEW-SUPPLIER-BATCH", expiry_date: "2099-12-25", total_cost: "400" });
  expect(requests[0].data).not.toHaveProperty("supplier_id");
  expect(requests[0].data).toMatchObject({ tablets_per_strip: 10, strips_per_box: 10, units: [{ unit_key: "base", selling_price: "7" }, { unit_key: "strip", selling_price: "65" }, { unit_key: "box", selling_price: "620" }] });
  await page.getByRole("button", { name: "Add Another Medicine", exact: true }).click();
  await page.getByLabel("Medicine Name").fill("Another supplier medicine");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("combobox", { name: /Purchased From/ })).toHaveValue("");
});

test("no saved suppliers links to Suppliers and preserves optional initial-stock receiving", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route("**/__test/save", async (route) => { payload = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, id: newId, quantity: 200 } }); });
  await start(page, "&suppliers=none");
  await expect(page.getByText("No suppliers saved yet. Add one from Suppliers.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Suppliers", exact: true })).toHaveAttribute("href", "/suppliers");
  await stock(page); await prices(page);
  await expect(page.getByRole("region", { name: "Medicine review" })).toContainText("Supplier not recorded");
  await noOverflow(page);
  await page.getByRole("button", { name: "Save Medicine", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Medicine added successfully." })).toBeVisible();
  expect(payload?.stock).toMatchObject({ supplier_id: "", quantity: 2, unit_key: "box" });
});

test("typing an unknown supplier never creates one or records a supplier name as an ID", async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route("**/__test/save", async (route) => { payload = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, id: newId, quantity: 200 } }); });
  await start(page);
  const picker = page.getByRole("combobox", { name: /Purchased From/ });
  await picker.fill("Unknown supplier name");
  await expect(page.getByText("No saved supplier matches. Try another name.")).toBeVisible();
  await picker.press("Escape");
  await expect(picker).toHaveValue("");
  await stock(page); await prices(page);
  await expect(page.getByRole("region", { name: "Medicine review" })).toContainText("Supplier not recorded");
  await page.getByRole("button", { name: "Save Medicine", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Medicine added successfully." })).toBeVisible();
  expect(payload?.stock).toMatchObject({ supplier_id: "" });
});

test("uncertain save retries the same supplier receipt and key with editing locked", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/__test/save", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: requests.length === 1 ? { ok: false, uncertain: true, error: "Could not confirm the save. Retry the same entries to check their status." } : { ok: true, id: newId, quantity: 200 } });
  });
  await start(page); await selectSupplier(page); await stock(page); await prices(page);
  await page.getByRole("button", { name: "Save Medicine", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry Save", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^Price of 1 Tablet/ })).toBeDisabled();
  await expect(page.getByRole("region", { name: "Medicine review" })).toContainText(suppliers[0].name);
  await page.getByRole("button", { name: "Retry Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Medicine added successfully." })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});
