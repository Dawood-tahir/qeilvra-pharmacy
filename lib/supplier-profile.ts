import { localDateISO } from "@/lib/utils";

export type Supplier = {
  id: string; name: string; contact_person: string | null; phone: string | null;
  email: string | null; address: string | null; tax_number: string | null;
  is_active: boolean; created_at: string;
};
export type PurchaseSummary = {
  id: string; supplier_id: string | null; invoice_date: string; status: string;
  total: number; purchase_items: { medicine_id: string }[];
};
export type SupplierSummary = {
  total: number; deliveries: number; medicineCount: number; drafts: number;
  lastPurchase: string | null; lastPurchases: Record<string, string>;
};
export function summarizeSupplier(supplierId: string, purchases: PurchaseSummary[]): SupplierSummary {
  const result: SupplierSummary = { total: 0, deliveries: 0, medicineCount: 0, drafts: 0, lastPurchase: null, lastPurchases: {} };
  // Purchase headers are the canonical receipts for all three receiving workflows.
  // Never infer supplier identity from the medicine or its current batches.
  const seen = new Set<string>();
  let minorTotal = 0;
  for (const purchase of purchases) {
    if (purchase.supplier_id !== supplierId || seen.has(purchase.id)) continue;
    seen.add(purchase.id);
    if (purchase.status === "draft") result.drafts++;
    if (purchase.status !== "posted") continue;
    minorTotal += Math.round(Number(purchase.total) * 100);
    result.deliveries++;
    if (!result.lastPurchase || purchase.invoice_date > result.lastPurchase) result.lastPurchase = purchase.invoice_date;
    for (const item of purchase.purchase_items) {
      const previous = result.lastPurchases[item.medicine_id];
      if (!previous || purchase.invoice_date > previous) result.lastPurchases[item.medicine_id] = purchase.invoice_date;
    }
  }
  result.total = minorTotal / 100;
  result.medicineCount = Object.keys(result.lastPurchases).length;
  return result;
}

export type InventoryMedicine = { id: string; name: string; strength: string | null; base_unit: string; reorder_level: number; is_active: boolean };
export type InventoryBatch = { medicine_id: string; quantity_on_hand: number; expiry_date: string; is_quarantined: boolean };
export type SupplierAlert = InventoryMedicine & {
  available: number; nearestExpiry: string | null; lastPurchase: string;
  statuses: ("Out of Stock" | "Low Stock" | "Expiring Soon")[];
};

export function supplierAlerts(medicines: InventoryMedicine[], batches: InventoryBatch[], lastPurchases: Record<string, string>, expiryDays: number, today = localDateISO()): SupplierAlert[] {
  // Same eligibility and inclusive expiry boundary as inventory_search / inventory_alerts:
  // positive, non-quarantined batches, expiry >= today's date in Asia/Karachi.
  const inventory = new Map<string, { available: number; nearestExpiry: string | null }>();
  for (const batch of batches) {
    if (batch.is_quarantined || Number(batch.quantity_on_hand) <= 0 || batch.expiry_date < today) continue;
    const stock = inventory.get(batch.medicine_id) ?? { available: 0, nearestExpiry: null };
    stock.available += Number(batch.quantity_on_hand);
    if (!stock.nearestExpiry || batch.expiry_date < stock.nearestExpiry) stock.nearestExpiry = batch.expiry_date;
    inventory.set(batch.medicine_id, stock);
  }
  const cutoff = new Date(today + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() + expiryDays);
  const expiryLimit = cutoff.toISOString().slice(0, 10);
  return medicines.flatMap((medicine): SupplierAlert[] => {
    if (!medicine.is_active || !lastPurchases[medicine.id]) return [];
    const stock = inventory.get(medicine.id) ?? { available: 0, nearestExpiry: null };
    const statuses: SupplierAlert["statuses"] = [];
    if (stock.available <= 0) statuses.push("Out of Stock");
    else {
      if (stock.available <= Number(medicine.reorder_level)) statuses.push("Low Stock");
      if (stock.nearestExpiry && stock.nearestExpiry <= expiryLimit) statuses.push("Expiring Soon");
    }
    return statuses.length ? [{ ...medicine, ...stock, statuses, lastPurchase: lastPurchases[medicine.id] }] : [];
  }).sort((a, b) => {
    const priority = (item: SupplierAlert) => item.statuses.includes("Out of Stock") ? 0 : item.statuses.includes("Low Stock") ? 1 : 2;
    return priority(a) - priority(b) || a.available - b.available || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

export type ReceivedItem = {
  id: string; medicine_id: string; batch_number: string; expiry_date: string;
  quantity: number; unit_cost: number; line_total: number; received_unit: string | null;
  received_quantity: number | null; base_units_per_received_unit: number | null;
  medicines: { name: string; strength: string | null; sku: string; base_unit: string };
};
export type SupplierInvoice = {
  id: string; purchase_number: string; supplier_invoice_number: string | null;
  invoice_date: string; posted_at: string | null; status: string; total: number;
  purchase_items: ReceivedItem[];
};
export type SupplierDelivery = ReceivedItem & { purchases: Omit<SupplierInvoice, "purchase_items"> };

export function profilePage(value?: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 100_000) : 1;
}

export function searchPattern(value: string) {
  // PostgREST OR syntax treats punctuation as operators. Accept literal words only.
  return "%" + value.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim().replace(/\s+/g, "%") + "%";
}
