"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveOutcomeUnknown } from "@/lib/save-result";

export async function createExpenseAction(formData: FormData) {
  const staff = await requireOwner();
  const parsed = z.object({ category_id: z.uuid(), amount: z.coerce.number().positive(), expense_date: z.iso.date(), payee: z.string().trim().max(160).default(""), description: z.string().trim().min(2).max(500), payment_method: z.enum(["cash", "card"]), reference: z.string().trim().max(120).default("") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Choose a category and enter the amount, date and description." };
  const supabase = await createClient();
  const { error } = await supabase.from("expenses").insert({ ...parsed.data, payee: parsed.data.payee || null, reference: parsed.data.reference || null, created_by: staff.id });
  if (error) return { ok: false, uncertain: saveOutcomeUnknown(error.code), error: saveOutcomeUnknown(error.code) ? "Could not confirm the expense. Check Expenses before recording it again." : "Expense could not be saved. Your entries are kept." };
  revalidatePath("/expenses"); revalidatePath("/dashboard"); revalidatePath("/reports");
  return { ok: true, message: "Expense recorded successfully." };
}

export async function createExpenseCategoryAction(formData: FormData) {
  await requireOwner();
  const name = z.string().trim().min(2).max(80).safeParse(formData.get("name"));
  if (!name.success) return { ok: false, error: "Enter a category name with at least two letters." };
  const supabase = await createClient();
  const { error } = await supabase.from("expense_categories").insert({ name: name.data });
  if (error) return { ok: false, error: "Category could not be added. Check whether that name already exists." };
  revalidatePath("/expenses");
  return { ok: true, message: "Expense category added." };
}
