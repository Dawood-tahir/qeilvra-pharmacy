"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const supplierSchema = z.object({
  name: z.string().trim().min(2).max(160), contact_person: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(), email: z.union([z.email(), z.literal("")]).optional(),
  address: z.string().trim().max(500).optional(), tax_number: z.string().trim().max(80).optional(),
});

export async function createSupplierAction(formData: FormData) {
  const staff = await requireOwner();
  const parsed = supplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase.from("suppliers").insert({ ...parsed.data, created_by: staff.id });
  revalidatePath("/suppliers");
}

export async function setSupplierActiveAction(formData: FormData) {
  await requireOwner();
  const parsed = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase.from("suppliers").update({ is_active: parsed.data.active === "true" }).eq("id", parsed.data.id);
  revalidatePath("/suppliers");
}
