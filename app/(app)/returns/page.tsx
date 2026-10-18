import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { ReviewReturn } from "@/components/returns/review-return";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export default async function ReturnsPage() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase.from("sale_returns").select("id,return_number,status,reason,refund_amount,requested_at,sales(id,invoice_number),profiles!sale_returns_requested_by_fkey(full_name),return_items(id,quantity,approved_quantity,restockable,sale_items(medicine_name,unit_label))").order("requested_at", { ascending: false }).limit(100);
  const returns = data ?? [];
  return <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8"><p className="text-sm font-semibold text-blue-700">Controlled refunds</p><h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{staff.role === "owner" ? "Returns & refunds" : "My return requests"}</h1><p className="mt-1 text-sm text-slate-500">Requested quantities, approval state, refund value and restock decisions.</p><Card className="mt-5"><CardContent className="p-0">{returns.length === 0 ? <EmptyState icon={RotateCcw} title="No return requests" description="Return requests submitted from an invoice will appear here." /> : <div className="divide-y divide-slate-100">{returns.map((entry) => { const sale = entry.sales as unknown as { id: string; invoice_number: string }; const requestor = entry.profiles as unknown as { full_name?: string }; const items = (entry.return_items ?? []).map((item) => ({ id: item.id, quantity: Number(item.quantity), medicine: ((item.sale_items as unknown as { medicine_name: string })?.medicine_name ?? "Medicine") + " (" + ((item.sale_items as unknown as { unit_label?: string })?.unit_label ?? "original unit") + ")" })); return <article key={entry.id} className="p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="font-extrabold">{entry.return_number}</h2><Badge variant={entry.status === "approved" ? "success" : entry.status === "rejected" ? "destructive" : "warning"}>{entry.status}</Badge></div><p className="mt-1 text-xs text-slate-500"><Link href={`/sales/${sale.id}`} className="font-semibold text-blue-700">{sale.invoice_number}</Link> · {formatDateTime(entry.requested_at)}{staff.role === "owner" ? ` · ${requestor?.full_name ?? "Staff"}` : ""}</p></div><div className="flex items-center gap-3">{entry.status === "approved" && <strong>{formatCurrency(entry.refund_amount)}</strong>}{staff.role === "owner" && entry.status === "requested" && <ReviewReturn returnId={entry.id} items={items} />}</div></div><p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{entry.reason}</p><div className="mt-3 flex flex-wrap gap-2">{items.map((item) => <span key={item.id} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold">{item.medicine} · {item.quantity}</span>)}</div></article>; })}</div>}</CardContent></Card></main>;
}
