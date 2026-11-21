import type { Metadata } from "next";
import { PosWorkspace } from "@/components/pos/pos-workspace";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadInventory } from "@/lib/load-inventory";

export const metadata: Metadata = { title: "POS / Sales" };

export default async function PosPage() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const catalog = await loadInventory(supabase).catch(() => undefined);
  return <PosWorkspace role={staff.role} staffId={staff.id} initialMedicines={catalog} />;
}
