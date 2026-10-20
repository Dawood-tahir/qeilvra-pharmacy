import type { Metadata } from "next";
import { PosWorkspace } from "@/components/pos/pos-workspace";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { StockMedicine } from "@/lib/medicine-units";

export const metadata: Metadata = { title: "POS / Sales" };

export default async function PosPage() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inventory_search", { p_query: "", p_limit: 30 });
  return <PosWorkspace role={staff.role} staffId={staff.id} initialMedicines={error ? undefined : (data ?? []) as StockMedicine[]} />;
}
