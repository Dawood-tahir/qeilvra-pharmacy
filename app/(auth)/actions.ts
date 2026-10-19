"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeAppPath } from "@/lib/navigation";

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
  next: z.string().optional(),
});

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/login?error=invalid");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) redirect("/login?error=credentials");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?error=credentials");
  const { data: profile } = await supabase.from("profiles").select("is_active").eq("id", user.id).single();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }
  redirect(safeAppPath(parsed.data.next));
}

export async function forgotPasswordAction(formData: FormData) {
  const email = z.email().max(254).safeParse(formData.get("email"));
  if (!email.success) redirect("/forgot-password?error=invalid");
  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${appUrl}/auth/callback?next=/update-password` });
  redirect("/forgot-password?sent=1");
}

export async function updatePasswordAction(formData: FormData) {
  const parsed = z.object({
    password: z.string().min(10).max(200),
    confirmPassword: z.string(),
  }).refine((data) => data.password === data.confirmPassword, { path: ["confirmPassword"] })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/update-password?error=invalid");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?error=expired");
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) redirect("/update-password?error=failed");
  redirect("/dashboard?password=updated");
}
