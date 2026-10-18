"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveOutcomeUnknown } from "@/lib/save-result";

export async function requestReturnAction(input: unknown) {
  await requireStaff();
  const parsed = z.object({ saleId: z.uuid(), reason: z.string().trim().min(3).max(500), items: z.array(z.object({ sale_item_id: z.uuid(), quantity: z.coerce.number().int().positive() })).min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Enter a whole return quantity and a reason of at least three characters." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_sale_return", { p_sale_id: parsed.data.saleId, p_items: parsed.data.items, p_reason: parsed.data.reason });
  if (error) return { ok: false as const, uncertain: saveOutcomeUnknown(error.code), error: saveOutcomeUnknown(error.code) ? "Could not confirm the request. Check Returns before sending it again." : error.message.includes("exceeds") ? error.message : "Return request could not be submitted. Check the quantities and reason." };
  revalidatePath("/returns"); revalidatePath(`/sales/${parsed.data.saleId}`);
  return { ok: true as const, id: data as string };
}

export async function reviewReturnAction(input: unknown) {
  await requireOwner();
  const parsed = z.object({ returnId: z.uuid(), approve: z.boolean(), notes: z.string().trim().max(500).default(""), paymentMethod: z.enum(["cash", "card"]).default("cash"), items: z.array(z.object({ return_item_id: z.uuid(), approved_quantity: z.coerce.number().int().min(0), restockable: z.boolean() })).default([]) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Check the return review." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_sale_return", { p_return_id: parsed.data.returnId, p_approve: parsed.data.approve, p_items: parsed.data.items, p_review_notes: parsed.data.notes, p_payment_method: parsed.data.paymentMethod });
  if (error) return { ok: false as const, error: "Could not confirm the return decision. Check Returns for its current status before trying again." };
  for (const path of ["/returns", "/dashboard", "/stock", "/medicines", "/pos", "/reports", "/sales"]) revalidatePath(path);
  revalidatePath("/sales/[id]", "page");
  return { ok: true as const, refund: data as number };
}
