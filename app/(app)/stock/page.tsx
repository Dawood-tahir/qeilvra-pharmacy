import Link from "next/link";
import { ChevronLeft, ChevronRight, PackageX, Search } from "lucide-react";
import { AdjustStock } from "@/components/stock/adjust-stock";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, localDateISO } from "@/lib/utils";

export default async function StockPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; medicine?: string }> }) {
  await requireOwner();
  const params = await searchParams;
  const query = (params.q ?? "").slice(0, 100);
  const page = Math.max(Number(params.page) || 1, 1);
  const pageSize = 30;
  const supabase = await createClient();
  let request = supabase.from("medicine_batches").select("id,batch_number,expiry_date,quantity_on_hand,purchase_cost,is_quarantined,medicines!inner(id,name,strength,sku,base_unit),suppliers(name)", { count: "exact" }).order("expiry_date").range((page - 1) * pageSize, page * pageSize - 1);
  if (params.medicine) request = request.eq("medicine_id", params.medicine);
  if (query) {
    const safeQuery = query.replace(/[,%()]/g, " ");
    const { data: matchingMedicines } = await supabase.from("medicines").select("id").or(`name.ilike.%${safeQuery}%,generic_name.ilike.%${safeQuery}%,sku.ilike.%${safeQuery}%`).limit(100);
    const medicineIds = (matchingMedicines ?? []).map((item) => item.id);
    request = request.or([`batch_number.ilike.%${safeQuery}%`, ...(medicineIds.length ? [`medicine_id.in.(${medicineIds.join(",")})`] : [])].join(","));
  }
  const { data, count } = await request;
  const batches = data ?? [];
  const today = localDateISO();
  const pageHref = (next: number) => `/stock?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(params.medicine ? { medicine: params.medicine } : {}), page: String(next) })}`;
  return <main className="mx-auto max-w-[1450px] p-4 sm:p-6 lg:p-8"><div><p className="text-sm font-semibold text-blue-700">Batch-level inventory</p><h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">Stock management</h1><p className="mt-1 text-sm text-slate-500">FEFO batches, expiry status and audited physical corrections.</p></div><form className="relative mt-5"><Search className="absolute left-3 top-3.5 size-5 text-slate-400" /><input name="q" defaultValue={query} className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder="Search medicine or batch number" /></form><Card className="mt-4 overflow-hidden"><CardContent className="p-0">{batches.length === 0 ? <EmptyState icon={PackageX} title="No stock batches found" description="Post a medicine purchase to create inventory batches." /> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3">Medicine</th><th className="px-4 py-3">Batch</th><th className="px-4 py-3">Expiry</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Quantity</th><th className="px-4 py-3">Unit cost</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"><span className="sr-only">Action</span></th></tr></thead><tbody>{batches.map((row) => { const med = row.medicines as unknown as { id: string; name: string; strength?: string; sku: string; base_unit: string }; const supplier = row.suppliers as unknown as { name?: string } | null; const expired = row.expiry_date < today; return <tr key={row.id} className="border-t border-slate-100"><td className="px-5 py-3"><Link className="font-bold hover:text-blue-700" href={`/medicines/${med.id}`}>{med.name} {med.strength}</Link><p className="text-xs text-slate-500">{med.sku}</p></td><td className="px-4 py-3 font-medium">{row.batch_number}</td><td className="px-4 py-3">{formatDate(row.expiry_date)}</td><td className="px-4 py-3">{supplier?.name ?? "—"}</td><td className="px-4 py-3 font-extrabold">{row.quantity_on_hand} <span className="font-normal text-slate-500">{med.base_unit}</span></td><td className="px-4 py-3">{formatCurrency(row.purchase_cost)}</td><td className="px-4 py-3"><Badge variant={row.is_quarantined || expired ? "destructive" : Number(row.quantity_on_hand) <= 0 ? "neutral" : "success"}>{row.is_quarantined ? "Quarantined" : expired ? "Expired" : Number(row.quantity_on_hand) <= 0 ? "Empty" : "Sellable"}</Badge></td><td className="px-4 py-3"><AdjustStock batchId={row.id} medicine={`${med.name} ${med.strength ?? ""}`} batch={row.batch_number} quantity={Number(row.quantity_on_hand)} /></td></tr>; })}</tbody></table></div>}</CardContent></Card><div className="mt-4 flex items-center justify-between"><p className="text-xs text-slate-500">{count ?? 0} batches · Page {page}</p><div className="flex gap-2"><Link href={pageHref(Math.max(1, page - 1))} className={buttonVariants({ variant: "outline", size: "sm", className: page === 1 ? "pointer-events-none opacity-50" : "" })}><ChevronLeft /> Previous</Link><Link href={pageHref(page + 1)} className={buttonVariants({ variant: "outline", size: "sm", className: batches.length < pageSize ? "pointer-events-none opacity-50" : "" })}>Next <ChevronRight /></Link></div></div></main>;
}
