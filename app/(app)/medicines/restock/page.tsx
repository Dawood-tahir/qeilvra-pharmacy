import Link from "next/link";
import { RestockForm } from "@/components/medicines/restock-form";
import { Card, CardContent } from "@/components/ui/card";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { StockMedicine } from "@/lib/medicine-units";
export default async function RestockPage({ searchParams }: { searchParams: Promise<{ medicine?: string; supplier?: string }> }) {
  await requireOwner();
  const { medicine, supplier } = await searchParams;
  const supabase = await createClient();
  const { data: suppliers, error: supplierError } = await supabase.from("suppliers").select("id,name").eq("is_active", true).order("name");
  if (supplierError) throw new Error("Saved suppliers could not be loaded. Please try again.");
  let initial: StockMedicine | null = null;
  if (medicine) {
    const { data: item } = await supabase.from("medicines").select("sku").eq("id", medicine).maybeSingle();
    if (item) {
      const { data, error } = await supabase.rpc("inventory_search", { p_query: item.sku, p_limit: 50 });
      if (error) throw new Error("Medicine details could not be loaded.");
      initial = (data as StockMedicine[]).find((m) => m.id === medicine) ?? null;
    }
  }
  return <main className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8"><Link href="/medicines" className="inline-flex min-h-11 items-center text-sm font-semibold text-slate-600">Back to Inventory</Link><h1 className="mt-4 text-2xl font-extrabold">Add More Stock</h1><p className="mt-1 text-sm text-slate-500">Choose a medicine and saved supplier, enter the stock received, then review.</p><Card className="mt-5"><CardContent className="p-4 sm:p-6"><RestockForm initialMedicine={initial} initialSupplierId={supplier} suppliers={suppliers ?? []} /></CardContent></Card></main>;
}
