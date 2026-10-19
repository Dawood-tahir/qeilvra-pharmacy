import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { StockDisposition } from "@/lib/stock-disposition";
export async function loadDispositionHistory({ supplierId, purchaseId, medicineId, page = 1, stockPage = false }: { supplierId?: string; purchaseId?: string; medicineId?: string; page?: number; stockPage?: boolean }) {
  const staff = await requireOwner(); const client = await createClient(); const size = stockPage ? 20 : 6;
  let request = client.from("stock_dispositions").select("id,kind,medicine_id,medicine_name,batch_id,batch_number,quantity,base_unit,unit_cost,cost_value,reason,created_at,supplier_id,purchase_id,recovery_state,recovery_method,recovery_amount,confirmed_at,recovery_reference,replacement_purchase_id,suppliers(name),actor:profiles!stock_dispositions_created_by_fkey(full_name)").order("created_at", { ascending: false }).order("id", { ascending: false });
  if (supplierId) request = request.eq("supplier_id", supplierId);
  if (medicineId) request = request.eq("medicine_id", medicineId);
  if (purchaseId) request = request.or(`purchase_id.eq.${purchaseId},replacement_purchase_id.eq.${purchaseId}`);
  const { data, error } = await request.range((page - 1) * size, page * size);
  if (error) throw new Error("Stock disposal and supplier return history could not load. Please retry.");
  const rows = (data ?? []).slice(0, size) as unknown as StockDisposition[];
  return { rows, staffId: staff.id, page, size, hasMore: (data?.length ?? 0) > size, supplierId, purchaseId, medicineId, stockPage };
}
