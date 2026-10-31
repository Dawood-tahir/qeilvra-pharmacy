import { expect, test, type Page } from "@playwright/test";
import { medicine } from "../ui/data";

async function newBoxMedicine(page: Page) {
  await page.route("**/api/medicines/search?**", route => route.fulfill({ json: [] }));
  await page.goto("/medicines/new");
  await page.getByLabel("Medicine Name").fill("CAD 22");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Boxes", exact: true }).click();
  await page.getByLabel("How many did you buy?").fill("1");
  await page.getByLabel("How many tablets are in one strip?").fill("12");
  await page.getByLabel("How many strips are in one box?").fill("11");
  await page.getByLabel("Batch number").fill("CAD22-BATCH");
  await page.getByLabel("Expiry date").fill("2099-12-25");
  await page.getByLabel("Total purchase cost").fill("1000");
  await page.getByRole("button", { name: "Next", exact: true }).click();
}
async function editMedicine(page: Page) {
  await page.route("**/api/medicines/search?**", route => route.fulfill({ json: [] }));
  await page.goto(`/medicines/${medicine.id}/edit`);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
}

test("box input instantly calculates CAD 22 prices in box, strip, tablet order", async ({ page }) => {
  await newBoxMedicine(page);
  const fields = page.getByRole("spinbutton", { name: /^Price of 1 / });
  await expect(fields).toHaveCount(3);
  await expect(fields.nth(0)).toHaveAccessibleName(/Price of 1 Box/);
  await expect(fields.nth(1)).toHaveAccessibleName(/Price of 1 Strip/);
  await expect(fields.nth(2)).toHaveAccessibleName(/Price of 1 Tablet/);
  await page.getByLabel(/^Price of 1 Box/).fill("1320");
  await expect(page.getByLabel(/^Price of 1 Strip/)).toHaveValue("120.00");
  await expect(page.getByLabel(/^Price of 1 Tablet/)).toHaveValue("10.00");
  await expect(page.getByLabel(/^Price of 1 Strip/)).toHaveAttribute("readonly", "");
  await expect(page.getByLabel(/^Price of 1 Tablet/)).toHaveAttribute("readonly", "");
  await expect(page.getByText("Auto-calculated from box price", { exact: true })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/box-pricing-${test.info().project.name}.png`, fullPage: true });
});

test("recalculates for price and packaging changes without changing the entered box price", async ({ page }) => {
  await newBoxMedicine(page);
  await page.getByLabel(/^Price of 1 Box/).fill("2640");
  await expect(page.getByLabel(/^Price of 1 Strip/)).toHaveValue("240.00");
  await expect(page.getByLabel(/^Price of 1 Tablet/)).toHaveValue("20.00");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByLabel("How many tablets are in one strip?").fill("6");
  await page.getByLabel("How many strips are in one box?").fill("5");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByLabel(/^Price of 1 Box/)).toHaveValue("2640");
  await expect(page.getByLabel(/^Price of 1 Strip/)).toHaveValue("528.00");
  await expect(page.getByLabel(/^Price of 1 Tablet/)).toHaveValue("88.00");
});

test("rounds currency safely and clears dependents for invalid or empty box inputs", async ({ page }) => {
  await newBoxMedicine(page);
  await page.getByLabel(/^Price of 1 Box/).fill("100");
  await expect(page.getByLabel(/^Price of 1 Strip/)).toHaveValue("9.09");
  await expect(page.getByLabel(/^Price of 1 Tablet/)).toHaveValue("0.76");
  await expect(page.getByLabel(/^Price of 1 Box/)).toHaveValue("100");
  for (const value of ["", "-1", "0", "1.001"]) {
    await page.getByLabel(/^Price of 1 Box/).fill(value);
    await expect(page.getByLabel(/^Price of 1 Strip/)).toHaveValue("");
    await expect(page.getByLabel(/^Price of 1 Tablet/)).toHaveValue("");
  }
  await page.getByRole("button", { name: "Save Medicine", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Enter a box selling price");
});

test("keeps the permitted selling-price limit and original purchase information", async ({ page }) => {
  let saved: { data: Record<string, unknown>; stock: Record<string, unknown> } | undefined;
  await page.route("**/__test/save", async route => { saved = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, id: medicine.id, quantity: 132 } }); });
  await newBoxMedicine(page);
  await page.getByLabel(/^Price of 1 Box/).fill("1320");
  await page.getByText("Permitted selling-price limit (optional)", { exact: true }).nth(1).click();
  await page.getByLabel("Maximum price of 1 strip (Rs.)").fill("119");
  await page.getByRole("button", { name: "Save Medicine", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("permitted limit");
  expect(saved).toBeUndefined();
  await page.getByLabel("Maximum price of 1 strip (Rs.)").fill("121");
  await page.getByRole("button", { name: "Save Medicine", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Medicine added successfully." })).toBeVisible();
  expect(saved?.data).toMatchObject({ tablets_per_strip: 12, strips_per_box: 11, pricing_mode: "box", units: [
    { unit_key: "base", selling_price: "10.00" }, { unit_key: "strip", selling_price: "120.00", max_price: "121" }, { unit_key: "box", selling_price: "1320" },
  ] });
  expect(saved?.stock).toMatchObject({ quantity: 1, unit_key: "box", total_cost: "1000", batch_number: "CAD22-BATCH", expiry_date: "2099-12-25" });
});

test("opening a legacy edit and saving other details preserves its independent prices", async ({ page }) => {
  const requests: { data: Record<string, unknown>; stock: unknown }[] = [];
  await page.route("**/__test/save", async route => { requests.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true, id: medicine.id, quantity: 0 } }); });
  await editMedicine(page);
  await expect(page.getByLabel(/^Price of 1 Box/)).toHaveValue("620");
  await expect(page.getByLabel(/^Price of 1 Strip/)).toHaveValue("62.00");
  await expect(page.getByLabel(/^Price of 1 Tablet/)).toHaveValue("6.20");
  await expect(page.getByRole("status")).toContainText("Existing prices are kept until you change the box price");
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Medicine updated successfully." })).toBeVisible();
  expect(requests[0]).toMatchObject({ stock: null, data: { pricing_mode: "preserve", units: [
    { unit_key: "base", selling_price: "7" }, { unit_key: "strip", selling_price: "65" }, { unit_key: "box", selling_price: "620" },
  ] } });
});

test("intentionally changing an existing box price adopts the calculated strip and tablet prices", async ({ page }) => {
  let saved: { data: Record<string, unknown> } | undefined;
  await page.route("**/__test/save", async route => { saved = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, id: medicine.id, quantity: 0 } }); });
  await editMedicine(page);
  await page.getByLabel(/^Price of 1 Box/).fill("1240");
  await expect(page.getByLabel(/^Price of 1 Strip/)).toHaveValue("124.00");
  await expect(page.getByLabel(/^Price of 1 Tablet/)).toHaveValue("12.40");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Medicine updated successfully." })).toBeVisible();
  expect(saved?.data).toMatchObject({ pricing_mode: "box", units: [
    { unit_key: "base", selling_price: "12.40" }, { unit_key: "strip", selling_price: "124.00" }, { unit_key: "box", selling_price: "1240" },
  ] });
});
