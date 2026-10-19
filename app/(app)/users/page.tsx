import { ActionForm } from "@/components/ui/action-form";
import { Mail, Phone, UserPlus, Users } from "lucide-react";
import { inviteSalespersonAction, setSalespersonActiveAction } from "@/app/(app)/users/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export default async function UsersPage() {
  await requireOwner();
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id,full_name,phone,is_active,last_seen_at,created_at,user_roles!inner(role)").eq("user_roles.role", "salesperson").order("full_name");
  if (error) throw new Error("Salespeople could not be loaded. Please try again.");
  const users = (data ?? []) as Array<{ id: string; full_name: string; phone: string | null; is_active: boolean; last_seen_at: string | null; created_at: string }>;
  return <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8"><div><p className="text-sm font-semibold text-blue-700">Owner administration</p><h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">Salespeople</h1><p className="mt-1 text-sm text-slate-500">Invite salespeople to sell medicines and print invoices. Deactivate an account when access is no longer needed.</p></div><details className="mt-5 rounded-2xl border border-blue-200 bg-blue-50/60"><summary className="flex cursor-pointer list-none items-center gap-2 p-4 font-bold text-blue-800"><UserPlus className="size-5" /> Invite salesperson</summary><ActionForm action={inviteSalespersonAction} checkHref="/users" resetOnSuccess className="grid gap-4 border-t border-blue-100 bg-white p-4 sm:grid-cols-3"><label><span className="mb-1.5 block text-sm font-semibold">Full name *</span><Input name="full_name" required minLength={2} /></label><label><span className="mb-1.5 block text-sm font-semibold">Email *</span><Input name="email" type="email" required /></label><label><span className="mb-1.5 block text-sm font-semibold">Phone</span><Input name="phone" /></label><div className="sm:col-span-3"><Button><Mail /> Send secure invitation</Button><p className="mt-2 text-xs text-slate-500">The salesperson receives an email link to set their password.</p></div></ActionForm></details><Card className="mt-4"><CardContent className="p-0">{users.length === 0 ? <EmptyState icon={Users} title="No salespeople" description="Invite a salesperson to give them access to POS and their own transactions." /> : <div className="divide-y divide-slate-100">{users.map((user) => <div key={user.id} className="flex flex-wrap items-center gap-3 p-4"><span className="grid size-11 place-items-center rounded-full bg-blue-100 font-bold text-blue-700">{user.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong>{user.full_name}</strong><Badge variant={user.is_active ? "success" : "neutral"}>{user.is_active ? "Active" : "Inactive"}</Badge></span><span className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">{user.phone && <span className="flex gap-1"><Phone className="size-3" />{user.phone}</span>}<span>Added {formatDate(user.created_at)}</span>{user.last_seen_at && <span>Last active {formatDate(user.last_seen_at)}</span>}</span></span><ActionForm action={setSalespersonActiveAction}><input type="hidden" name="id" value={user.id} /><input type="hidden" name="active" value={String(!user.is_active)} /><Button variant="outline" size="sm" className={user.is_active ? "text-red-600" : "text-emerald-700"}>{user.is_active ? "Deactivate" : "Reactivate"}</Button></ActionForm></div>)}</div>}</CardContent></Card></main>;
}
