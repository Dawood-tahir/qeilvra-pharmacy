"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function adjustStockAction(input: unknown) {
  await requireOwner();
  const parsed = z.object({ batchId: z.uuid(), quantityDelta: z.coerce.number().refine((v) => v !== 0, "Quantity cannot be zero."), reason: z.string().trim().min(3).max(500) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check the adjustment." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adjust_stock", { p_batch_id: parsed.data.batchId, p_quantity_delta: parsed.data.quantityDelta, p_reason: parsed.data.reason });
  if (error) return { ok: false as const, error: error.message.includes("negative inventory") ? "This adjustment would create negative inventory." : "Stock could not be adjusted." };
  revalidatePath("/stock"); revalidatePath("/medicines"); revalidatePath("/dashboard");
  return { ok: true as const, quantity: data as number };
}
