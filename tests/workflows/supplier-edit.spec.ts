import { expect, test } from "@playwright/test";

const supplierId = "50000000-0000-4000-8000-000000000005";
const path = `/suppliers/${supplierId}`;
async function openEditor(page: import("@playwright/test").Page) {
  await page.goto(path);
  await page.getByRole("button", { name: "Edit Supplier", exact: true }).click();
  return page.getByRole("dialog", { name: "Edit Supplier Information", exact: true });
}

test("supplier editor prefills seven fields, keeps Deactivate and fits the viewport with trapped keyboard focus", async ({ page }) => {
  const dialog = await openEditor(page);
  await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toHaveCount(1);
  await expect(dialog.getByLabel("Supplier / Company Name *")).toHaveValue("City Medical Supplies");
  await expect(dialog.getByLabel("Contact Person Name")).toHaveValue("Ahmed");
  await expect(dialog.getByLabel("Primary Phone Number")).toHaveValue("0300 0000000");
  await expect(dialog.getByLabel("Email Address")).toHaveValue("orders@city-medical-supplies.example.test");
  for (const label of ["Full Business Address", "City", "Tax Registration Number"]) await expect(dialog.getByLabel(label)).toHaveValue("");
  await expect(dialog.locator("input,textarea")).toHaveCount(7);
  await expect(dialog.getByLabel("Supplier / Company Name *")).toBeFocused();
  for (let index = 0; index < 20; index++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("dialog")?.getAttribute("aria-label"))).toBe("Edit Supplier Information");
  }
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/supplier-edit-${test.info().project.name}.png`, fullPage: true });
});

test("Cancel and Escape warn before discarding unsaved supplier changes", async ({ page }) => {
  let writes = 0;
  await page.route("**/__test/supplier-update", route => { writes++; return route.fulfill({ json: { ok: true } }); });
  const dialog = await openEditor(page);
  await dialog.getByLabel("City").fill("Lahore");
  page.once("dialog", confirmation => confirmation.dismiss());
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog.getByLabel("City")).toHaveValue("Lahore");
  page.once("dialog", confirmation => confirmation.accept());
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Supplier", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Edit Supplier", exact: true }).click();
  await expect(page.getByLabel("City", { exact: true })).toHaveValue("");
  expect(writes).toBe(0);
});

test("client validation identifies company, phone and email errors while preserving all entries", async ({ page }) => {
  const dialog = await openEditor(page);
  await dialog.getByLabel("Supplier / Company Name *").fill(" ");
  await dialog.getByLabel("Primary Phone Number").fill("call Ahmed");
  await dialog.getByLabel("Email Address").fill("test@gmail");
  await dialog.getByRole("button", { name: "Save Changes", exact: true }).click();
  for (const label of ["Supplier / Company Name *", "Primary Phone Number", "Email Address"]) await expect(dialog.getByLabel(label)).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByLabel("Email Address")).toHaveValue("test@gmail");
  await expect(dialog.getByText(/Enter a complete email address/)).toBeVisible();
});

test("saving blocks repeated submissions, retains failed edits and shows success only after confirmation", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route("**/__test/supplier-update", async route => {
    calls++;
    const body = route.request().postDataJSON();
    expect(body.id).toBe(supplierId);
    expect(Object.keys(body.values).sort()).toEqual(["name", "contact_person", "phone", "email", "address", "city", "tax_number"].sort());
    if (calls === 1) { await gate; await route.fulfill({ json: { ok: false, error: "Supplier update failed. Try again." } }); }
    else await route.fulfill({ json: { ok: true } });
  });
  const dialog = await openEditor(page);
  await dialog.getByLabel("City").fill("Lahore");
  await dialog.getByLabel("Primary Phone Number").fill("+44 (20) 7946-0958");
  await dialog.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Saving...", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(page.getByText("Supplier information updated successfully.", { exact: true })).toHaveCount(0);
  release();
  await expect(dialog.getByRole("alert")).toContainText("Supplier update failed.");
  await expect(dialog.getByLabel("City")).toHaveValue("Lahore");
  await expect(dialog.getByLabel("Primary Phone Number")).toHaveValue("+44 (20) 7946-0958");
  await dialog.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Supplier information updated successfully.", { exact: true })).toBeVisible();
  expect(calls).toBe(2);
});
