import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PurchaseForm } from "@/components/purchases/purchase-form";
import { Card, CardContent } from "@/components/ui/card";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function NewPurchasePage() {
  await requireOwner();
  const supabase = await createClient();
  const { data, error } = await supabase.from("suppliers").select("id,name").eq("is_active", true).order("name");
  if (error) throw new Error("Saved suppliers could not be loaded. Please try again.");
  return <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8"><Link href="/purchases" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600"><ArrowLeft className="size-4" /> Purchases</Link><h1 className="mt-4 text-2xl font-extrabold sm:text-3xl">New purchase</h1><p className="mt-1 text-sm text-slate-500">Record one supplier invoice. Save a draft, review it, then post it to add stock. Do not enter a delivery already saved through Add More Stock.</p><Card className="mt-5"><CardContent className="p-5 sm:p-7"><PurchaseForm suppliers={data ?? []} /></CardContent></Card></main>;
}
