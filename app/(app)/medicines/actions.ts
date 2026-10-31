"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guidedMedicineSchema, receiveStockSchema } from "@/lib/guided-medicine";
import { requireOperationsManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveOutcomeUnknown } from "@/lib/save-result";
import { deriveBoxPricingInput, hasBoxPackaging } from "@/lib/box-pricing";


function safeError(message: string, code?: string) {
  if (code === "23505") return "This medicine, barcode or code already exists. Use Add More Stock for an existing medicine.";
  return /^(Enter |Choose |Confirm |The Owner |Existing fractional|Packaging is fixed|This medicine|This selling|Check |Selling price|Stock must)/.test(message) ? message : "Could not save. Your entries are kept. Check your connection and try again.";
}
function refreshInventory() {
  revalidatePath("/suppliers/[id]", "page");
  for (const path of ["/medicines", "/stock", "/purchases", "/dashboard", "/reports", "/pos"]) revalidatePath(path);
}
export async function saveGuidedMedicineAction(id: string | null, input: unknown, stock: unknown, requestKey: string) {
  await requireOperationsManager();
  if (!z.uuid().safeParse(requestKey).success || (id !== null && !z.uuid().safeParse(id).success)) return { ok: false as const, error: "Check the medicine details." };
  let payload = input;
  let supabase: Awaited<ReturnType<typeof createClient>> | undefined;
  if (hasBoxPackaging(input)) {
    let preserve = false;
    if (id && input.pricing_mode === "preserve") {
      supabase = await createClient();
      const { data: existing, error } = await supabase.from("medicines").select("dosage_form,tablets_per_strip,strips_per_box,medicine_units(unit_key,selling_price,max_price)").eq("id", id).maybeSingle();
      if (error || !existing) return { ok: false as const, error: "Existing medicine prices could not be loaded. Your entries are kept. Please try again." };
      preserve = existing.dosage_form === input.dosage_form && existing.tablets_per_strip === input.tablets_per_strip && existing.strips_per_box === input.strips_per_box;
      if (preserve) {
        const submitted = Array.isArray(input.units) ? input.units as Record<string, unknown>[] : [];
        const saved = existing.medicine_units as { unit_key: string; selling_price: number; max_price: number | null }[];
        payload = { ...input, units: saved.map(unit => {
          const candidate = submitted.find(candidate => candidate?.unit_key === unit.unit_key);
          return { unit_key: unit.unit_key, selling_price: String(unit.selling_price), max_price: candidate?.max_price === undefined ? unit.max_price == null ? null : String(unit.max_price) : candidate.max_price };
        }) };
      }
    }
    if (!preserve) {
      const derived = deriveBoxPricingInput(input);
      if (!derived.ok) return { ok: false as const, error: derived.error };
      payload = derived.data;
    }
  }
  const parsed = guidedMedicineSchema.safeParse(payload);
  const receipt = stock === null && id ? null : receiveStockSchema.safeParse(stock);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  if (receipt && !receipt.success) return { ok: false as const, error: receipt.error.issues[0].message };
  supabase ??= await createClient();
  const { data, error } = await supabase.rpc("save_guided_medicine", { p_id: id, p_data: parsed.data, p_stock: receipt?.data ?? null, p_key: requestKey });
  if (error) return { ok: false as const, uncertain: saveOutcomeUnknown(error.code), error: saveOutcomeUnknown(error.code) ? "Could not confirm the save. Retry the same entries to check their status." : safeError(error.message, error.code) };
  refreshInventory();
  if (id) {
    revalidatePath(`/medicines/${id}`);
    revalidatePath(`/medicines/${id}/edit`);
  }
  return { ok: true as const, id: String(data.id), quantity: Number(data.quantity) };
}
export async function receiveStockAction(id: string, input: unknown, requestKey: string) {
  await requireOperationsManager();
  const parsed = receiveStockSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(requestKey).success) return { ok: false as const, error: "Select a medicine and try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_stock", { p_id: id, p_stock: parsed.data, p_key: requestKey });
  if (error) return { ok: false as const, uncertain: saveOutcomeUnknown(error.code), error: saveOutcomeUnknown(error.code) ? "Could not confirm the save. Retry the same stock receipt to check its status." : safeError(error.message, error.code) };
  refreshInventory();
  return { ok: true as const, id: String(data.id), quantity: Number(data.quantity) };
}
