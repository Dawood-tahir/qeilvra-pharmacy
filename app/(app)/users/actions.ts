"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function inviteSalespersonAction(formData: FormData) {
  await requireOwner();
  const parsed = z.object({ full_name: z.string().trim().min(2).max(100), email: z.email().max(254), phone: z.string().trim().max(40).default("") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Enter the salesperson name and a valid email address." };
  const admin = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { data, error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, { redirectTo: `${appUrl}/auth/callback?next=/update-password`, data: { full_name: parsed.data.full_name } });
  if (error || !data.user) return { ok: false, error: "Invitation could not be sent. Check the email address and email delivery settings." };
  const { error: profileError } = await admin.from("profiles").insert({ id: data.user.id, full_name: parsed.data.full_name, phone: parsed.data.phone || null });
  const { error: roleError } = profileError ? { error: profileError } : await admin.from("user_roles").insert({ user_id: data.user.id, role: "salesperson" });
  if (profileError || roleError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { ok: false, error: "The invitation could not be completed. Please try again." };
  }
  revalidatePath("/users");
  return { ok: true, message: "Invitation sent. Ask the salesperson to check their email." };
}

export async function setSalespersonActiveAction(formData: FormData) {
  const owner = await requireOwner();
  const parsed = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success || parsed.data.id === owner.id) return { ok: false, error: "Select a Salesperson account." };
  const supabase = await createClient();
  const { data: targetRole } = await supabase.from("user_roles").select("role").eq("user_id", parsed.data.id).single();
  if (targetRole?.role !== "salesperson") throw new Error("Only Salesperson accounts can be changed here.");
  const admin = createAdminClient();
  const { error: profileError } = await admin.from("profiles").update({ is_active: parsed.data.active === "true" }).eq("id", parsed.data.id);
  const { error: accessError } = await admin.auth.admin.updateUserById(parsed.data.id, { ban_duration: parsed.data.active === "true" ? "none" : "876000h" });
  revalidatePath("/users");
  if (profileError || accessError) return { ok: false, error: "Account access could not be fully updated. Check its status before trying again." };
  return { ok: true, message: parsed.data.active === "true" ? "Salesperson access restored." : "Salesperson access deactivated." };
}
