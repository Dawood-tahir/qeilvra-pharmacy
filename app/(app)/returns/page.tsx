import { RecordSearchResults, RecordSearchScope } from "@/components/ui/record-search-results";
import { HistorySearch } from "@/components/ui/live-route-form";
import { NO_SEARCH_MATCHES, searchQuery, textSearchFilter } from "@/lib/live-search";
import { Pagination } from "@/components/ui/pagination";
import { HISTORY_PAGE_SIZE, pageNumber } from "@/lib/pagination";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { ReviewReturn } from "@/components/returns/review-return";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireStaff } from "@/lib/auth";
import { canManageOperations } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export default async function ReturnsPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ page?: string; q?: string | string[] }> } = {}) {
  const params = await searchParams;
  const page = pageNumber(params.page);
  const query = searchQuery(params.q);
  const staff = await requireStaff();
  const supabase = await createClient();
  let request = supabase.from("sale_returns").select("id,return_number,status,reason,refund_amount,requested_at,sales(id,invoice_number),profiles!sale_returns_requested_by_fkey(full_name),return_items(id,quantity,approved_quantity,base_quantity,approved_base_quantity,restockable,sale_items(medicine_name,unit_label,medicines(base_unit)))").order("requested_at", { ascending: false }).order("id", { ascending: false });
  if (query) request = request.or(textSearchFilter(query, "return_number", "reason"));
  const { data, error } = await request.range((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);
  if (error) throw new Error("Returns could not be loaded. Please try again.");
  const returns = (data ?? []).slice(0, HISTORY_PAGE_SIZE);
  return <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8"><p className="text-sm font-semibold text-blue-700">Return history</p><h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{canManageOperations(staff.role) ? "Returns & refunds" : "My returns"}</h1><p className="mt-1 text-sm text-slate-500">Complete returns immediately from Return / Refund in POS. Completed refunds and historical requests appear here.</p><RecordSearchScope complete={page === 1 && !query && (data?.length ?? 0) <= HISTORY_PAGE_SIZE} query={query}><HistorySearch action="/returns" query={query} label="Search return number or reason" /><Card className="mt-5"><CardContent className="p-0"><RecordSearchResults empty={<EmptyState icon={RotateCcw} title={query ? NO_SEARCH_MATCHES : "No returns yet"} description="Completed returns will appear here." />} rows={returns.map((entry) => { const sale = entry.sales as unknown as { id: string; invoice_number: string }; const requestor = entry.profiles as unknown as { full_name?: string }; const items = (entry.return_items ?? []).map((item) => ({ id: item.id, quantity: Number(item.base_quantity ?? item.quantity), approved: Number(item.approved_base_quantity ?? item.approved_quantity ?? 0), restockable: item.restockable, medicine: ((item.sale_items as unknown as { medicine_name: string })?.medicine_name ?? "Medicine") + " (" + (item.base_quantity != null ? ((item.sale_items as unknown as { medicines?: { base_unit?: string } })?.medicines?.base_unit ?? "base unit") : ((item.sale_items as unknown as { unit_label?: string })?.unit_label ?? "original unit")) + ")" })); return { id: entry.id, fields: [entry.return_number, entry.reason], content: <article key={entry.id} className="p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="break-words font-extrabold">{entry.return_number}</h2><Badge variant={entry.status === "approved" ? "success" : entry.status === "rejected" ? "destructive" : "warning"}>{entry.status === "approved" ? "Completed" : entry.status === "requested" ? "Historical request" : "Rejected"}</Badge></div><p className="mt-1 text-xs text-slate-500"><Link prefetch={false} href={`/sales/${sale.id}`} className="font-semibold text-blue-700">{sale.invoice_number}</Link> · {formatDateTime(entry.requested_at)}{canManageOperations(staff.role) ? ` · ${requestor?.full_name ?? "Staff"}` : ""}</p></div><div className="flex items-center gap-3">{entry.status === "approved" && <strong>{formatCurrency(entry.refund_amount)}</strong>}{canManageOperations(staff.role) && entry.status === "requested" && <ReviewReturn returnId={entry.id} invoiceNumber={sale.invoice_number} items={items} />}</div></div><p className="mt-3 break-words rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{entry.reason}</p><div className="mt-3 flex flex-wrap gap-2">{items.map((item) => <span key={item.id} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold">{item.medicine} · Requested: {item.quantity}{entry.status === "approved" && <span className="mt-1 block text-slate-600">Approved: {item.approved} · {item.approved === 0 ? "No stock added" : item.restockable ? "Marked for restocking" : "Not returned to stock"}</span>}</span>)}</div></article> }; })} /></CardContent></Card><Pagination pathname="/returns" page={page} hasMore={(data?.length ?? 0) > HISTORY_PAGE_SIZE} query={{ q: query }} /></RecordSearchScope></main>;
}
