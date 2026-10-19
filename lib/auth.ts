import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "owner" | "salesperson";
export type StaffUser = {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
};

export const getCurrentStaff = cache(async (): Promise<StaffUser | null> => {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const { data: profile } = await supabase.from("profiles").select("full_name,is_active,user_roles!inner(role)").eq("id", user.id).single();
  const roles = profile?.user_roles as unknown as { role: string }[] | { role: string } | undefined;
  const role = Array.isArray(roles) ? roles[0]?.role : roles?.role;

  if (!profile?.is_active || (role !== "owner" && role !== "salesperson")) return null;
  return {
    id: user.id,
    email: user.email ?? "",
    fullName: profile.full_name,
    role,
  };
});

export async function requireStaff() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login?error=inactive");
  return staff;
}

export async function requireOwner() {
  const staff = await requireStaff();
  if (staff.role !== "owner") redirect("/dashboard?error=forbidden");
  return staff;
}
