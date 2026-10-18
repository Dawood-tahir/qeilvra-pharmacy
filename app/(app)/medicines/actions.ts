"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guidedMedicineSchema, receiveStockSchema } from "@/lib/guided-medicine";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveOutcomeUnknown } from "@/lib/save-result";


function safeError(message: string, code?: string) {
  if (code === "23505") return "This medicine, barcode or code already exists. Use Add More Stock for an existing medicine.";
  return /^(Enter |Choose |Confirm |The Owner |Existing fractional|Packaging is fixed|This medicine|This selling|Check |Selling price|Stock must)/.test(message) ? message : "Could not save. Your entries are kept. Check your connection and try again.";
}
function refreshInventory() {
  for (const path of ["/medicines", "/stock", "/purchases", "/dashboard", "/pos"]) revalidatePath(path);
}
export async function saveGuidedMedicineAction(id: string | null, input: unknown, stock: unknown, requestKey: string) {
  await requireOwner();
  const parsed = guidedMedicineSchema.safeParse(input);
  const receipt = stock === null && id ? null : receiveStockSchema.safeParse(stock);
  if (!z.uuid().safeParse(requestKey).success || (id !== null && !z.uuid().safeParse(id).success)) return { ok: false as const, error: "Check the medicine details." };
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  if (receipt && !receipt.success) return { ok: false as const, error: receipt.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_guided_medicine", { p_id: id, p_data: parsed.data, p_stock: receipt?.data ?? null, p_key: requestKey });
  if (error) return { ok: false as const, uncertain: saveOutcomeUnknown(error.code), error: saveOutcomeUnknown(error.code) ? "Could not confirm the save. Retry the same entries to check their status." : safeError(error.message, error.code) };
  refreshInventory();
  return { ok: true as const, id: String(data.id), quantity: Number(data.quantity) };
}
export async function receiveStockAction(id: string, input: unknown, requestKey: string) {
  await requireOwner();
  const parsed = receiveStockSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(requestKey).success) return { ok: false as const, error: "Select a medicine and try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_stock", { p_id: id, p_stock: parsed.data, p_key: requestKey });
  if (error) return { ok: false as const, uncertain: saveOutcomeUnknown(error.code), error: saveOutcomeUnknown(error.code) ? "Could not confirm the save. Retry the same stock receipt to check its status." : safeError(error.message, error.code) };
  refreshInventory();
  return { ok: true as const, id: String(data.id), quantity: Number(data.quantity) };
}
