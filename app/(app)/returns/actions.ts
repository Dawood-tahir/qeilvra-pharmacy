"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function requestReturnAction(input: unknown) {
  await requireStaff();
  const parsed = z.object({ saleId: z.uuid(), reason: z.string().trim().min(3).max(500), items: z.array(z.object({ sale_item_id: z.uuid(), quantity: z.coerce.number().positive() })).min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check the return request." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_sale_return", { p_sale_id: parsed.data.saleId, p_items: parsed.data.items, p_reason: parsed.data.reason });
  if (error) return { ok: false as const, error: error.message.includes("exceeds") ? error.message : "Return request could not be submitted." };
  revalidatePath("/returns"); revalidatePath(`/sales/${parsed.data.saleId}`);
  return { ok: true as const, id: data as string };
}

export async function reviewReturnAction(input: unknown) {
  await requireOwner();
  const parsed = z.object({ returnId: z.uuid(), approve: z.boolean(), notes: z.string().trim().max(500).default(""), paymentMethod: z.enum(["cash", "card"]).default("cash"), items: z.array(z.object({ return_item_id: z.uuid(), approved_quantity: z.coerce.number().min(0), restockable: z.boolean() })).default([]) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Check the return review." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_sale_return", { p_return_id: parsed.data.returnId, p_approve: parsed.data.approve, p_items: parsed.data.items, p_review_notes: parsed.data.notes, p_payment_method: parsed.data.paymentMethod });
  if (error) return { ok: false as const, error: "Return could not be reviewed. No refund or stock change was recorded." };
  revalidatePath("/returns"); revalidatePath("/dashboard"); revalidatePath("/stock");
  return { ok: true as const, refund: data as number };
}
