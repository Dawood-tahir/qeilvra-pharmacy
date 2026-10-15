"use server";

import { revalidatePath } from "next/cache";
import { medicineSchema } from "@/app/(app)/medicines/schema";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type SaveMedicineResult = { ok: true; id: string } | { ok: false; error: string };

export async function saveMedicineAction(id: string | null, input: unknown): Promise<SaveMedicineResult> {
  await requireOwner();
  const parsed = medicineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the medicine details." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_medicine", { p_medicine_id: id, p_data: parsed.data });
  if (error) {
    const duplicate = error.code === "23505";
    return { ok: false, error: duplicate ? "That barcode or SKU is already in use." : "Medicine could not be saved. Check the values and try again." };
  }
  revalidatePath("/medicines");
  revalidatePath("/dashboard");
  return { ok: true, id: data as string };
}
