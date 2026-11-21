import { RecordSearchResults, RecordSearchScope } from "@/components/ui/record-search-results";
import { HistorySearch } from "@/components/ui/live-route-form";
import { NO_SEARCH_MATCHES, searchQuery, textSearchFilter } from "@/lib/live-search";
import { Pagination } from "@/components/ui/pagination";
import { HISTORY_PAGE_SIZE, pageNumber } from "@/lib/pagination";
import Link from "next/link";
import { PackageSearch, Plus, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOperationsManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function PurchasesPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ page?: string; q?: string | string[] }> } = {}) {
  const params = await searchParams;
  const page = pageNumber(params.page);
  const query = searchQuery(params.q);
  await requireOperationsManager();
  const supabase = await createClient();
  let request = supabase.from("purchases").select("id,purchase_number,supplier_invoice_number,invoice_date,status,total,created_at,suppliers(name),purchase_items(count)").order("created_at", { ascending: false }).order("id", { ascending: false });
  if (query) request = request.or(textSearchFilter(query, "purchase_number", "supplier_invoice_number"));
  const { data, error } = await request.range((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);
  if (error) throw new Error("Purchases could not be loaded. Please try again.");
  const purchases = (data ?? []).slice(0, HISTORY_PAGE_SIZE);
  return <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-blue-700">Stock receiving</p><h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">Purchases</h1><p className="mt-1 text-sm text-slate-500">Review supplier deliveries here. Drafts add stock only when you post them.</p></div><Link href="/purchases/new" className={buttonVariants()}><Plus /> New purchase</Link></div><RecordSearchScope complete={page === 1 && !query && (data?.length ?? 0) <= HISTORY_PAGE_SIZE} query={query}><HistorySearch action="/purchases" query={query} label="Search invoice or supplier reference" /><Card className="mt-5"><CardContent className="p-0"><RecordSearchResults empty={<EmptyState icon={PackageSearch} title={query ? NO_SEARCH_MATCHES : "No purchases recorded"} description="Create a draft purchase to begin receiving medicine batches." />} headings={<thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3">Purchase</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Invoice date</th><th className="px-4 py-3">Items</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Status</th></tr></thead>} rows={purchases.map((purchase) => ({
    id: purchase.id, fields: [purchase.purchase_number, purchase.supplier_invoice_number],
    content: <tr key={purchase.id} className="border-t border-slate-100"><td className="px-5 py-3"><Link prefetch={false} className="font-bold text-blue-700" href={`/purchases/${purchase.id}`}>{purchase.purchase_number}</Link><p className="text-xs text-slate-500">{purchase.supplier_invoice_number || "No supplier invoice"}</p></td><td className="px-4 py-3">{(purchase.suppliers as unknown as { name?: string })?.name ?? "Supplier not recorded"}</td><td className="px-4 py-3">{formatDate(purchase.invoice_date)}</td><td className="px-4 py-3">{(purchase.purchase_items as unknown as { count: number }[])?.[0]?.count ?? 0}</td><td className="px-4 py-3 font-bold">{formatCurrency(purchase.total)}</td><td className="px-4 py-3"><Badge variant={purchase.status === "posted" ? "success" : purchase.status === "draft" ? "warning" : "neutral"}>{purchase.status}</Badge></td></tr>,
    compact: <Link prefetch={false} href={`/purchases/${purchase.id}`} key={purchase.id} className="flex items-center gap-3 p-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><Truck /></span><span className="min-w-0 flex-1"><span className="block break-words font-bold">{purchase.purchase_number}</span><span className="block truncate text-xs text-slate-500">{(purchase.suppliers as unknown as { name?: string })?.name ?? "Supplier not recorded"} · {formatDate(purchase.invoice_date)}</span></span><span className="text-right"><span className="block font-bold">{formatCurrency(purchase.total)}</span><Badge variant={purchase.status === "posted" ? "success" : "warning"}>{purchase.status}</Badge></span></Link>,
  }))} /></CardContent></Card><Pagination pathname="/purchases" page={page} hasMore={(data?.length ?? 0) > HISTORY_PAGE_SIZE} query={{ q: query }} /></RecordSearchScope></main>;
}
