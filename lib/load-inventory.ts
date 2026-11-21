import type { StockMedicine } from "@/lib/medicine-units";
import { loadMedicineCatalog } from "@/lib/load-medicine-catalog";
import type { createClient } from "@/lib/supabase/server";

export function loadInventory(client: Awaited<ReturnType<typeof createClient>>) {
  return loadMedicineCatalog(async (offset, limit) => {
    const { data, error } = await client.rpc("inventory_search", { p_query: "", p_limit: limit, p_offset: offset });
    if (error) throw new Error("Inventory could not be loaded. Please try again.");
    return (data ?? []) as StockMedicine[];
  });
}
