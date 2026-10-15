"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function createExpenseAction(formData: FormData) {
  const staff = await requireOwner();
  const parsed = z.object({ category_id: z.uuid(), amount: z.coerce.number().positive(), expense_date: z.iso.date(), payee: z.string().trim().max(160).default(""), description: z.string().trim().min(2).max(500), payment_method: z.enum(["cash", "card"]), reference: z.string().trim().max(120).default("") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase.from("expenses").insert({ ...parsed.data, payee: parsed.data.payee || null, reference: parsed.data.reference || null, created_by: staff.id });
  revalidatePath("/expenses"); revalidatePath("/dashboard"); revalidatePath("/reports");
}

export async function createExpenseCategoryAction(formData: FormData) {
  await requireOwner();
  const name = z.string().trim().min(2).max(80).safeParse(formData.get("name"));
  if (!name.success) return;
  const supabase = await createClient();
  await supabase.from("expense_categories").insert({ name: name.data });
  revalidatePath("/expenses");
}
