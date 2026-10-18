import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Barcode, Boxes, CalendarClock, Edit3, Pill, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function MedicineDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  const supabase = await createClient();
  const { data: medicine } = await supabase.from("medicines").select("id,name,generic_name,manufacturer,strength,dosage_form,barcode,sku,selling_price,reorder_level,base_unit,units_per_pack,is_active,packaging_status,tablets_per_strip,strips_per_box,medicine_units(unit_key,label,base_quantity,selling_price,max_price),medicine_categories(name)").eq("id", id).single();
  if (!medicine) notFound();
  const { data: inventory } = await supabase.rpc("search_sellable_medicines", { p_query: medicine.sku, p_limit: 2, p_offset: 0 });
  const stock = ((inventory ?? []) as Array<Record<string, unknown>>).find((item) => item.id === id);
  let batches: Array<Record<string, unknown>> = [];
  let cost: { default_purchase_cost: number } | null = null;
  if (staff.role === "owner") {
    const [batchResult, costResult] = await Promise.all([
      supabase.from("medicine_batches").select("id,batch_number,expiry_date,quantity_on_hand,purchase_cost,is_quarantined,suppliers(name)").eq("medicine_id", id).order("expiry_date"),
      supabase.from("medicine_costs").select("default_purchase_cost").eq("medicine_id", id).maybeSingle(),
    ]);
    batches = batchResult.data ?? []; cost = costResult.data;
  }
  return <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8"><div className="flex items-center justify-between gap-4"><Link href="/medicines" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600"><ArrowLeft className="size-4" /> Medicines</Link>{staff.role === "owner" && <Link href={`/medicines/${id}/edit`} className={buttonVariants({ variant: "outline" })}><Edit3 /> Edit Medicine & Prices</Link>}</div><div className="mt-5 flex items-start gap-4"><span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-blue-100 text-blue-700"><Pill className="size-7" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-extrabold sm:text-3xl">{medicine.name} {medicine.strength}</h1><Badge variant={medicine.is_active ? "success" : "neutral"}>{medicine.is_active ? "Active" : "Archived"}</Badge></div><p className="mt-1 text-sm text-slate-500">{[medicine.generic_name, medicine.dosage_form, medicine.manufacturer].filter(Boolean).join(" · ") || "No additional description"}</p></div></div>
    {staff.role === "owner" && <Link className={buttonVariants({ className: "mt-5" })} href={`/medicines/restock?medicine=${id}`}>Add More Stock</Link>}<section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4"><Info icon={Tag} label="Selling price" value={formatCurrency(medicine.selling_price)} /><Info icon={Boxes} label="Available stock" value={`${stock?.available_quantity ?? 0} ${medicine.base_unit}`} /><Info icon={CalendarClock} label="Nearest expiry" value={stock?.nearest_expiry ? formatDate(String(stock.nearest_expiry)) : "No sellable batch"} /><Info icon={Barcode} label="SKU / barcode" value={`${medicine.sku}${medicine.barcode ? ` · ${medicine.barcode}` : ""}`} /></section>
    <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.5fr]"><Card><CardHeader><CardTitle>Packaging and selling prices</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">{medicine.packaging_status !== "confirmed" && <p className="rounded-xl bg-amber-50 p-3 text-amber-900">Packaging needs Owner review before stock can be added or sold.</p>}<Row label="Stock counted in" value={medicine.base_unit} />{medicine.medicine_units?.map((u: { unit_key: string; label: string; base_quantity: number; selling_price: number }) => <Row key={u.unit_key} label={"1 " + u.label + (u.base_quantity > 1 ? " (" + u.base_quantity + " " + medicine.base_unit + "s)" : "")} value={formatCurrency(u.selling_price)} />)}<Row label="Reorder level" value={String(medicine.reorder_level)} />{staff.role === "owner" && cost && <Row label="Default purchase cost" value={formatCurrency(cost.default_purchase_cost)} />}</CardContent></Card>{staff.role === "owner" ? <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>Stock by batch</CardTitle><Link href={`/stock?medicine=${id}`} className="text-xs font-bold text-blue-700">Manage stock</Link></CardHeader><CardContent>{batches.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">No batches received yet. Use Add More Stock to receive a batch.</p> : <div className="space-y-2">{batches.map((batch) => <div key={String(batch.id)} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-slate-100 p-3"><div><p className="text-sm font-bold">Batch {String(batch.batch_number)}</p><p className="mt-0.5 text-xs text-slate-500">Expires {formatDate(String(batch.expiry_date))} · {(batch.suppliers as { name?: string } | null)?.name ?? "No supplier"}</p></div><div className="text-right"><p className="font-extrabold">{String(batch.quantity_on_hand)}</p><p className="text-xs text-slate-500">{formatCurrency(Number(batch.purchase_cost))} cost</p></div></div>)}</div>}</CardContent></Card> : <Card><CardHeader><CardTitle>Stock guidance</CardTitle></CardHeader><CardContent><p className="text-sm leading-6 text-slate-600">Only unexpired, non-quarantined batches are included in available stock. The POS automatically sells the earliest-expiring valid batch first.</p></CardContent></Card>}</div>
  </main>;
}

function Info({ icon: Icon, label, value }: { icon: typeof Tag; label: string; value: string }) { return <Card><CardContent className="p-4"><Icon className="size-5 text-blue-600" /><p className="mt-3 text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 truncate font-extrabold text-slate-950">{value}</p></CardContent></Card>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4 border-b border-slate-100 pb-3 last:border-0 last:pb-0"><span className="text-slate-500">{label}</span><strong>{value}</strong></div>; }
