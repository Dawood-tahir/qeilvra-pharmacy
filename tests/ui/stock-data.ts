import { medicine, purchase, sale, suppliers } from "./data";

export const stockBatchId = "ba000000-0000-4000-8000-000000000001";
export const stockReturnId = "ba000000-0000-4000-8000-000000000002";
export function stockFixtureTables(): Record<string, Record<string, unknown>[]> {
  return {
    medicine_batches: [{ id: stockBatchId, medicine_id: medicine.id, supplier_id: null, batch_number: "DISPOSAL-BATCH", expiry_date: "2020-01-01", quantity_on_hand: 200, purchase_cost: 2, is_quarantined: false, medicines: medicine, suppliers: null, purchase_items: { purchases: { supplier_id: suppliers[0].id, suppliers: suppliers[0] } } }],
    stock_dispositions: [{ id: stockReturnId, kind: "supplier_return", medicine_id: medicine.id, medicine_name: "Paracetamol 500mg", batch_id: stockBatchId, batch_number: "DISPOSAL-BATCH", quantity: 10, base_unit: "tablet", unit_cost: 2, cost_value: 20, reason: "Damaged tablets returned to original dealer", created_at: sale.completed_at, supplier_id: suppliers[0].id, purchase_id: purchase.id, recovery_state: "pending", recovery_method: "credit", recovery_amount: 0, confirmed_at: null, recovery_reference: null, replacement_purchase_id: null, suppliers: suppliers[0], actor: { full_name: "Test Owner" } }],
  };
}
