import { localDateISO } from "@/lib/utils";
import { medicine, suppliers } from "./data";

const expiry = (days: number) => { const date = new Date(localDateISO() + "T12:00:00Z"); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
export const profileMedicines = [
  { ...medicine, reorder_level: 20 },
  { ...medicine, id: "40000000-0000-4000-8000-000000000005", name: "Amoxicillin", strength: "250mg", sku: "AM", reorder_level: 10, base_unit: "capsule" },
  { ...medicine, id: "40000000-0000-4000-8000-000000000006", name: "Cetirizine", strength: "10mg", sku: "CT", reorder_level: 50 },
  { ...medicine, id: "40000000-0000-4000-8000-000000000007", name: "Omeprazole", strength: "20mg", sku: "OM", reorder_level: 10, base_unit: "capsule" },
];
const purchases = Array.from({ length: 15 }, (_, index) => {
  const med = profileMedicines[index >= 10 && index <= 12 ? index - 9 : 0];
  return {
    id: "90000000-0000-4000-8000-" + String(index + 20).padStart(12, "0"), supplier_id: suppliers[0].id,
    purchase_number: `PUR-PROFILE-${String(index + 1).padStart(2, "0")}`, supplier_invoice_number: `CITY-${index + 1}`, suppliers: suppliers[0], subtotal: 200, discount: index === 0 ? 10 : 0,
    invoice_date: `2026-10-${String(index + 1).padStart(2, "0")}`, posted_at: `2026-10-${String(index + 1).padStart(2, "0")}T10:00:00Z`, status: "posted", total: index === 0 ? 190 : 200,
    purchase_items: [{ id: `profile-item-${index}`, medicine_id: med.id, medicines: med, batch_number: "REPEAT-BATCH", expiry_date: "2098-12-25", quantity: 200, unit_cost: 1, line_total: 200, received_unit: "box", received_quantity: 2, base_units_per_received_unit: 100 }],
  };
});
const draft = { ...purchases[0], id: "draft-profile", purchase_number: "PUR-DRAFT", status: "draft", total: 999, invoice_date: "2026-10-18", posted_at: null };
const other = { ...purchases[0], id: "other-profile", supplier_id: suppliers[1].id, total: 888 };
const unassigned = { ...purchases[0], id: "unassigned-profile", supplier_id: null, total: 777 };
const batches = [
  { id: "a", medicine_id: medicine.id, quantity_on_hand: 2, expiry_date: expiry(200), is_quarantined: false, supplier_id: suppliers[0].id },
  { id: "b", medicine_id: medicine.id, quantity_on_hand: 3, expiry_date: expiry(200), is_quarantined: false, supplier_id: suppliers[1].id },
  { id: "c", medicine_id: profileMedicines[1].id, quantity_on_hand: 100, expiry_date: expiry(-1), is_quarantined: false },
  { id: "d", medicine_id: profileMedicines[1].id, quantity_on_hand: 100, expiry_date: expiry(200), is_quarantined: true },
  { id: "e", medicine_id: profileMedicines[2].id, quantity_on_hand: 20, expiry_date: expiry(200), is_quarantined: false },
  { id: "f", medicine_id: profileMedicines[3].id, quantity_on_hand: 100, expiry_date: expiry(10), is_quarantined: false },
];
export function supplierFixtureTables(): Record<string, Record<string, unknown>[]> {
  const empty = new URLSearchParams(location.search).get("fixture") === "empty";
  const invoices = empty ? [] : [...purchases, draft, other, unassigned];
  return { suppliers, purchases: invoices, purchase_items: invoices.flatMap((invoice) => invoice.purchase_items.map((item) => ({ ...item, purchases: invoice }))), medicines: profileMedicines, medicine_batches: batches, pharmacy_settings: [{ id: true, expiry_alert_days: 60 }] };
}
