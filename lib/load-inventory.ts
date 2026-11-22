import type { InventoryBatchExpiry } from "@/lib/inventory-filters";
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

export async function loadInventoryBatchExpiries(client: Awaited<ReturnType<typeof createClient>>, medicineIds: string[]) {
  const rows: InventoryBatchExpiry[] = [];
  for (let start = 0; start < medicineIds.length; start += 100) {
    const { data, error } = await client.rpc("inventory_batch_expiries", {
      p_medicine_ids: medicineIds.slice(start, start + 100),
    });
    // Keep the catalog available if the expiry migration is pending or this lookup fails.
    if (error) return null;
    rows.push(...((data ?? []) as InventoryBatchExpiry[]));
  }
  return rows;
}
