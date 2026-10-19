"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveOutcomeUnknown } from "@/lib/save-result";

const supplierSchema = z.object({
  name: z.string().trim().min(2).max(160), contact_person: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(), email: z.union([z.email(), z.literal("")]).optional(),
  address: z.string().trim().max(500).optional(), tax_number: z.string().trim().max(80).optional(),
});

export async function createSupplierAction(formData: FormData) {
  const staff = await requireOwner();
  const parsed = supplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Enter a supplier name and check the contact details." };
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").insert({ ...parsed.data, created_by: staff.id });
  if (error) return { ok: false, uncertain: saveOutcomeUnknown(error.code), error: "Could not confirm the supplier save. Check Suppliers before adding it again." };
  revalidatePath("/suppliers"); revalidatePath("/medicines/restock"); revalidatePath("/purchases/new");
  return { ok: true, message: "Supplier saved. You can now select it when receiving stock." };
}

export async function setSupplierActiveAction(formData: FormData) {
  await requireOwner();
  const parsed = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Select a saved supplier." };
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").update({ is_active: parsed.data.active === "true" }).eq("id", parsed.data.id);
  if (error) return { ok: false, error: "Supplier status could not be changed. Please try again." };
  revalidatePath(`/suppliers/${parsed.data.id}`);
  revalidatePath("/suppliers"); revalidatePath("/medicines/restock"); revalidatePath("/purchases/new");
  return { ok: true, message: parsed.data.active === "true" ? "Supplier reactivated." : "Supplier deactivated. Previous purchases are kept." };
}
