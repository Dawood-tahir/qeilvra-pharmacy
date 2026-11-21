import { RecordSearchResults, RecordSearchScope } from "@/components/ui/record-search-results";
import { HistorySearch } from "@/components/ui/live-route-form";
import { NO_SEARCH_MATCHES, searchQuery, textSearchFilter } from "@/lib/live-search";
import { Pagination } from "@/components/ui/pagination";
import { HISTORY_PAGE_SIZE, pageNumber } from "@/lib/pagination";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ArchiveDownload } from "@/components/sales/archive-download";
import { requireStaff } from "@/lib/auth";
import { canManageOperations } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export default async function SalesPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ page?: string; q?: string | string[] }> } = {}) {
  const params = await searchParams;
  const page = pageNumber(params.page);
  const query = searchQuery(params.q);
  const staff = await requireStaff();
  const supabase = await createClient();
  let request = supabase.from("sales").select("id,invoice_number,net_total,extra_charge_amount,extra_charge_description,status,completed_at,sale_items(count),payments(method),profiles!sales_created_by_fkey(full_name)").order("completed_at", { ascending: false }).order("id", { ascending: false });
  if (query) request = request.or(textSearchFilter(query, "invoice_number"));
  const { data, error } = await request.range((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);
  if (error) throw new Error("Sales could not be loaded. Please try again.");
  const sales = (data ?? []).slice(0, HISTORY_PAGE_SIZE);
  return <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"><p className="text-sm font-semibold text-blue-700">Transaction history</p><h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{canManageOperations(staff.role) ? "Sales" : "My sales"}</h1><p className="mt-1 text-sm text-slate-500">Open an invoice to print it or complete a return. Completed sales and their refunds stay in your history.</p>{staff.role === "owner" && <div className="mt-4"><ArchiveDownload /></div>}<RecordSearchScope complete={page === 1 && !query && (data?.length ?? 0) <= HISTORY_PAGE_SIZE} query={query}><HistorySearch action="/sales" query={query} label="Search invoice number" /><Card className="mt-5"><CardContent className="p-0"><RecordSearchResults empty={<EmptyState icon={ReceiptText} title={query ? NO_SEARCH_MATCHES : "No sales yet"} description="Completed POS transactions will appear here." />} rows={sales.map((sale) => ({ id: sale.id, fields: [sale.invoice_number], content: <Link prefetch={false} href={`/sales/${sale.id}`} key={sale.id} className="flex items-center gap-3 p-4 hover:bg-slate-50"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><ReceiptText /></span><span className="min-w-0 flex-1"><span className="block break-words font-bold text-blue-700">{sale.invoice_number}</span><span className="block text-xs text-slate-500">{formatDateTime(sale.completed_at)} · {(sale.sale_items as unknown as { count: number }[])?.[0]?.count ?? 0} items{canManageOperations(staff.role) ? ` · ${(sale.profiles as unknown as { full_name?: string })?.full_name ?? "Staff"}` : ""}</span></span><span className="text-right"><span className="block font-extrabold">{formatCurrency(sale.net_total)}</span>{Number(sale.extra_charge_amount) > 0 && <span className="block max-w-48 break-words text-xs text-blue-700">Extra Charges: {formatCurrency(sale.extra_charge_amount)}{sale.extra_charge_description ? " · " + sale.extra_charge_description : ""}</span>}<Badge variant={sale.status === "completed" ? "success" : "warning"}>{sale.status.replaceAll("_", " ")}</Badge></span></Link> }))} /></CardContent></Card><Pagination pathname="/sales" page={page} hasMore={(data?.length ?? 0) > HISTORY_PAGE_SIZE} query={{ q: query }} /></RecordSearchScope></main>;
}
