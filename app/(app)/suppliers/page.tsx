import { Plus } from "lucide-react";
import { createSupplierAction } from "@/app/(app)/suppliers/actions";
import { SupplierDirectory, type DirectorySupplier } from "@/components/suppliers/supplier-directory";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireOperationsManager } from "@/lib/auth";
import { searchQuery } from "@/lib/live-search";
import { readAllRows } from "@/lib/load-rows";
import { pageNumber } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; page?: string }> }) {
  await requireOperationsManager();
  const supabase = await createClient();
  const params = await searchParams;
  const query = searchQuery(params.q);
  const page = pageNumber(params.page);
  const suppliers = await readAllRows<DirectorySupplier>((start, end) => supabase.from("suppliers")
    .select("id,name,contact_person,phone,email,address,tax_number,is_active")
    .order("name").order("id").range(start, end), "Suppliers could not be loaded. Please try again.");
  return <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"><div><p className="text-sm font-semibold text-blue-700">Purchasing partners</p><h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">Suppliers</h1><p className="mt-1 text-sm text-slate-500">Save suppliers once, then select them when receiving stock or recording purchases.</p></div><details className="q-glass-secondary group mt-5 overflow-hidden rounded-2xl border"><summary className="flex cursor-pointer list-none items-center gap-2 p-4 font-bold text-blue-800"><Plus className="size-5" /> Add supplier</summary><ActionForm action={createSupplierAction} checkHref="/suppliers" resetOnSuccess className="grid gap-4 border-t border-blue-100 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"><label><span className="mb-1.5 block text-sm font-semibold">Supplier name *</span><Input name="name" required minLength={2} /></label><label><span className="mb-1.5 block text-sm font-semibold">Contact person</span><Input name="contact_person" /></label><label><span className="mb-1.5 block text-sm font-semibold">Phone</span><Input name="phone" /></label><label><span className="mb-1.5 block text-sm font-semibold">Email</span><Input name="email" type="email" /></label><label><span className="mb-1.5 block text-sm font-semibold">Tax number</span><Input name="tax_number" /></label><label><span className="mb-1.5 block text-sm font-semibold">Address</span><Input name="address" /></label><div className="sm:col-span-2 lg:col-span-3"><Button><Plus /> Save supplier</Button></div></ActionForm></details><SupplierDirectory key={JSON.stringify([query, page])} records={suppliers} initialQuery={query} initialPage={page} /></main>;
}
