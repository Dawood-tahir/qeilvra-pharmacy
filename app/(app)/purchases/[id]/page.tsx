import Link from "next/link";
import { PurchaseItems } from "@/components/purchases/purchase-items";
import { ActionForm } from "@/components/ui/action-form";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, PackageCheck } from "lucide-react";
import { postPurchaseAction } from "@/app/(app)/purchases/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;
  const supabase = await createClient();
  const { data: purchase, error } = await supabase.from("purchases").select("*,suppliers(name,phone,email),purchase_items(id,batch_number,expiry_date,quantity,unit_cost,line_total,received_unit,received_quantity,base_units_per_received_unit,medicines(name,strength,sku,base_unit))").eq("id", id).single();
  if (error && error.code !== "PGRST116") throw new Error("Purchase could not be loaded. Please try again.");
  if (!purchase) notFound();
  const items = purchase.purchase_items ?? [];
  return <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8"><Link href="/purchases" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600"><ArrowLeft className="size-4" /> Purchases</Link><div className="mt-4 flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2"><h1 className="text-2xl font-extrabold sm:text-3xl">{purchase.purchase_number}</h1><Badge variant={purchase.status === "posted" ? "success" : "warning"}>{purchase.status}</Badge></div><p className="mt-1 text-sm text-slate-500">{(purchase.suppliers as { name?: string })?.name ?? "Supplier not recorded"} · Invoice {purchase.supplier_invoice_number || "not provided"} · {formatDate(purchase.invoice_date)}</p></div>{purchase.status === "draft" && <ActionForm action={postPurchaseAction} pendingMessage="Adding stock..."><input type="hidden" name="id" value={id} /><Button size="lg"><PackageCheck /> Post Purchase to Stock</Button></ActionForm>}</div>{purchase.status === "draft" && <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Draft only:</strong> this purchase has not changed inventory. Review the supplier, quantity, batch, expiry and cost before posting. Do not post a delivery already entered through Add More Stock.</div>}{purchase.status === "posted" && <div className="mt-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800"><CheckCircle2 /> Stock was added on {purchase.posted_at ? formatDate(purchase.posted_at) : "posting"}.</div>}<Card className="mt-5"><CardHeader><CardTitle>Purchased items</CardTitle></CardHeader><CardContent><PurchaseItems items={items} /><div className="ml-auto mt-5 max-w-sm space-y-2 text-sm"><div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{formatCurrency(purchase.subtotal)}</span></div><div className="flex justify-between"><span className="text-slate-500">Discount</span><span>-{formatCurrency(purchase.discount)}</span></div><div className="flex justify-between border-t pt-3 text-lg font-extrabold"><span>Total</span><span>{formatCurrency(purchase.total)}</span></div></div></CardContent></Card></main>;
}
