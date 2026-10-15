"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function saveSettingsAction(formData: FormData) {
  await requireOwner();
  const parsed = z.object({ pharmacy_name: z.string().trim().min(2).max(160), address: z.string().trim().max(500).default(""), phone: z.string().trim().max(40).default(""), email: z.union([z.email(), z.literal("")]).default(""), tax_number: z.string().trim().max(80).default(""), receipt_footer: z.string().trim().min(2).max(300), salesperson_max_discount_percent: z.coerce.number().min(0).max(100), expiry_alert_days: z.coerce.number().int().min(1).max(730) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase.from("pharmacy_settings").update({ ...parsed.data, address: parsed.data.address || null, phone: parsed.data.phone || null, email: parsed.data.email || null, tax_number: parsed.data.tax_number || null }).eq("id", true);
  revalidatePath("/settings");
}

export async function createMedicineCategoryAction(formData: FormData) {
  await requireOwner();
  const name = z.string().trim().min(2).max(80).safeParse(formData.get("name"));
  if (!name.success) return;
  const supabase = await createClient();
  await supabase.from("medicine_categories").insert({ name: name.data });
  revalidatePath("/settings"); revalidatePath("/medicines/new");
}
