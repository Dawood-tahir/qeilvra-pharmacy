import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export default async function SalesPage() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data } = await supabase.from("sales").select("id,invoice_number,net_total,status,completed_at,sale_items(count),payments(method),profiles!sales_created_by_fkey(full_name)").order("completed_at", { ascending: false }).limit(100);
  const sales = data ?? [];
  return <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"><p className="text-sm font-semibold text-blue-700">Transaction history</p><h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{staff.role === "owner" ? "Sales" : "My sales"}</h1><p className="mt-1 text-sm text-slate-500">Completed transactions are immutable. Returns appear as linked refund records.</p><Card className="mt-5"><CardContent className="p-0">{sales.length === 0 ? <EmptyState icon={ReceiptText} title="No sales yet" description="Completed POS transactions will appear here." /> : <div className="divide-y divide-slate-100">{sales.map((sale) => <Link href={`/sales/${sale.id}`} key={sale.id} className="flex items-center gap-3 p-4 hover:bg-slate-50"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><ReceiptText /></span><span className="min-w-0 flex-1"><span className="block font-bold text-blue-700">{sale.invoice_number}</span><span className="block text-xs text-slate-500">{formatDateTime(sale.completed_at)} · {(sale.sale_items as unknown as { count: number }[])?.[0]?.count ?? 0} items{staff.role === "owner" ? ` · ${(sale.profiles as unknown as { full_name?: string })?.full_name ?? "Staff"}` : ""}</span></span><span className="text-right"><span className="block font-extrabold">{formatCurrency(sale.net_total)}</span><Badge variant={sale.status === "completed" ? "success" : "warning"}>{sale.status.replaceAll("_", " ")}</Badge></span></Link>)}</div>}</CardContent></Card></main>;
}
