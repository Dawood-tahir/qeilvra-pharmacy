"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveOutcomeUnknown } from "@/lib/save-result";

const purchaseSchema = z.object({
  supplier_id: z.uuid(), supplier_invoice_number: z.string().trim().max(120).default(""),
  invoice_date: z.iso.date(), discount: z.coerce.number().min(0).default(0), notes: z.string().trim().max(1000).default(""),
  items: z.array(z.object({ medicine_id: z.uuid(), batch_number: z.string().trim().min(1).max(80), expiry_date: z.iso.date(), quantity: z.coerce.number().int().positive(), unit_key: z.enum(["base", "strip", "box"]), unit_cost: z.coerce.number().min(0) })).min(1).max(100),
});

export async function createPurchaseAction(input: unknown) {
  await requireOwner();
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check the purchase details." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_purchase", { p_data: { supplier_id: parsed.data.supplier_id, supplier_invoice_number: parsed.data.supplier_invoice_number, invoice_date: parsed.data.invoice_date, discount: parsed.data.discount, notes: parsed.data.notes }, p_items: parsed.data.items });
  if (error) return { ok: false as const, uncertain: saveOutcomeUnknown(error.code), error: saveOutcomeUnknown(error.code) ? "Could not confirm the draft. Check Purchases for this invoice before entering it again." : error.message.includes("Expired stock") ? error.message : "Purchase draft could not be created. Check the quantities, costs and discount." };
  revalidatePath("/purchases");
  revalidatePath("/suppliers/[id]", "page");
  return { ok: true as const, id: data as string };
}

export async function postPurchaseAction(formData: FormData) {
  await requireOwner();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Select a saved purchase." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_purchase", { p_purchase_id: id.data });
  if (error) return { ok: false, error: "Could not confirm stock posting. Check the purchase status before trying again." };
  revalidatePath("/suppliers/[id]", "page");
  revalidatePath("/purchases"); revalidatePath(`/purchases/${id.data}`); revalidatePath("/stock"); revalidatePath("/dashboard"); revalidatePath("/medicines"); revalidatePath("/pos");
  return { ok: true, message: "Purchase posted. Stock is now available." };
}
