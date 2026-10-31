import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

// Opt-in real database checks. Create and clean up only uniquely named fixtures;
// never edit an existing supplier or generate purchase/inventory transactions.
for (const role of ["OWNER", "MANAGER"] as const) {
  test(`${role.toLowerCase()} edits a supplier and sees persisted information after refresh`, async ({ page }) => {
    test.setTimeout(120000);
    const email = process.env[`E2E_${role}_EMAIL`];
    const password = process.env[`E2E_${role}_PASSWORD`];
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    test.skip(!email || !password || !url || !key, "Provide opt-in supplier editor credentials and public Supabase configuration.");
    const client = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: loginError } = await client.auth.signInWithPassword({ email: email!, password: password! });
    expect(loginError).toBeNull();
    const prefix = `QEILVRA edit test ${randomUUID()}`;
    let fixtureId: string | undefined;
    try {
      const { data: fixture, error } = await client.from("suppliers").insert({
        name: prefix, contact_person: "Original contact", phone: "03001234567", email: "original@example.test",
        address: "Original address", city: null, tax_number: "NTN-001 / A", created_by: auth.user!.id,
      }).select("id,created_by,created_at,is_active").single();
      expect(error).toBeNull();
      fixtureId = fixture!.id;
      await page.goto("/login");
      await page.getByLabel("Email address").fill(email!);
      await page.getByLabel("Password", { exact: true }).fill(password!);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 30000 });
      await page.goto(`/suppliers/${fixtureId}`);
      await page.getByRole("button", { name: "Edit Supplier", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Edit Supplier Information", exact: true });
      await expect(dialog).toBeVisible();
      await page.screenshot({ path: `test-results/supplier-edit-connected-${role.toLowerCase()}-${test.info().project.name}.png`, fullPage: true });
      await expect(dialog.getByLabel("Supplier / Company Name *")).toHaveValue(prefix);
      await expect(dialog.getByLabel("City")).toHaveValue("");
      const updatedName = `${prefix} updated`;
      const updates = {
        name: updatedName, contact_person: "Dr. Ahmed O'Neil", phone: "+92 300 1234567", email: "updated@example.test",
        address: "12 Main Road\nFloor 2", city: "Lahore", tax_number: "NTN-001 / B",
      };
      for (const [field, value] of Object.entries(updates)) await dialog.locator(`[name="${field}"]`).fill(value);
      await dialog.getByRole("button", { name: "Save Changes", exact: true }).click();
      await expect(dialog).toHaveCount(0, { timeout: 20000 });
      await expect(page.getByText("Supplier information updated successfully.", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: updatedName, exact: true })).toBeVisible();
      for (const value of [updates.phone, updates.email, updates.city, updates.tax_number]) await expect(page.getByText(value, { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { name: updatedName, exact: true })).toBeVisible();
      await expect(page.getByText(updates.city, { exact: true })).toBeVisible();
      const { data: saved, error: readError } = await client.from("suppliers").select("*").eq("id", fixtureId).single();
      expect(readError).toBeNull();
      expect(saved).toMatchObject({ ...fixture, ...updates });
      await page.getByRole("button", { name: "Edit Supplier", exact: true }).click();
      await expect(dialog.getByLabel("Full Business Address")).toHaveValue(updates.address);
      await expect(dialog.getByLabel("Tax Registration Number")).toHaveValue(updates.tax_number);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Deactivate", exact: true }).click();
      await expect(page.getByRole("button", { name: "Reactivate", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Edit Supplier", exact: true }).click();
      await dialog.getByLabel("City").fill("Karachi");
      await dialog.getByRole("button", { name: "Save Changes", exact: true }).click();
      await expect(dialog).toHaveCount(0, { timeout: 20000 });
      const { data: inactive } = await client.from("suppliers").select("is_active,city").eq("id", fixtureId).single();
      expect(inactive).toEqual({ is_active: false, city: "Karachi" });
      await page.getByRole("button", { name: "Reactivate", exact: true }).click();
      await expect(page.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
      await page.goto(`/suppliers?q=${encodeURIComponent(prefix)}`);
      await expect(page.getByRole("heading", { name: updatedName, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      if (fixtureId) {
        const { error } = await client.from("suppliers").delete().eq("id", fixtureId).like("name", `${prefix}%`);
        expect(error).toBeNull();
      }
      await client.auth.signOut({ scope: "local" });
    }
  });
}
