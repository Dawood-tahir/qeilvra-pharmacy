"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentStaff, requireOperationsManager } from "@/lib/auth";
import { canManageOperations } from "@/lib/permissions";
import { supplierInformationErrors, supplierInformationSchema, type SupplierUpdateResult } from "@/lib/supplier-information";
import { createClient } from "@/lib/supabase/server";
import { saveOutcomeUnknown } from "@/lib/save-result";

const supplierSchema = z.object({
  name: z.string().trim().min(2).max(160), contact_person: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(), email: z.union([z.email(), z.literal("")]).optional(),
  address: z.string().trim().max(500).optional(), tax_number: z.string().trim().max(80).optional(),
});

export async function createSupplierAction(formData: FormData) {
  const staff = await requireOperationsManager();
  const parsed = supplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Enter a supplier name and check the contact details." };
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").insert({ ...parsed.data, created_by: staff.id });
  if (error) return { ok: false, uncertain: saveOutcomeUnknown(error.code), error: "Could not confirm the supplier save. Check Suppliers before adding it again." };
  revalidatePath("/suppliers"); revalidatePath("/medicines/restock"); revalidatePath("/purchases/new");
  return { ok: true, message: "Supplier saved. You can now select it when receiving stock." };
}

export async function setSupplierActiveAction(formData: FormData) {
  await requireOperationsManager();
  const parsed = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Select a saved supplier." };
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").update({ is_active: parsed.data.active === "true" }).eq("id", parsed.data.id);
  if (error) return { ok: false, error: "Supplier status could not be changed. Please try again." };
  revalidatePath(`/suppliers/${parsed.data.id}`);
  revalidatePath("/suppliers"); revalidatePath("/medicines/restock"); revalidatePath("/purchases/new");
  return { ok: true, message: parsed.data.active === "true" ? "Supplier reactivated." : "Supplier deactivated. Previous purchases are kept." };
}

export async function updateSupplierAction(id: string, values: unknown): Promise<SupplierUpdateResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { ok: false, error: "Your session expired. Sign in again before saving supplier information." };
  if (!canManageOperations(staff.role)) return { ok: false, error: "You do not have permission to edit suppliers." };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Select a saved supplier before editing." };
  const parsed = supplierInformationSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "Check the highlighted supplier details.", fieldErrors: supplierInformationErrors(parsed.error) };

  const supabase = await createClient();
  // The schema allows only the seven information columns. The authenticated
  // session and existing RLS remain authoritative; no service-role client is used.
  const { data, error } = await supabase.from("suppliers").update(parsed.data).eq("id", id).select("id").maybeSingle();
  if (error) return { ok: false, error: error.code === "42501" ? "You do not have permission to edit this supplier." : "Supplier information could not be updated. Your entries are kept. Please try again." };
  if (!data) return { ok: false, error: "This supplier was not found or you no longer have permission to edit it." };

  revalidatePath(`/suppliers/${id}`);
  revalidatePath("/suppliers");
  revalidatePath("/medicines/new");
  revalidatePath("/medicines/restock");
  revalidatePath("/medicines/[id]", "page");
  revalidatePath("/stock");
  revalidatePath("/purchases");
  revalidatePath("/purchases/new");
  revalidatePath("/purchases/[id]", "page");
  return { ok: true };
}
