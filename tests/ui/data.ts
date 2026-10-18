import { localDateISO } from "@/lib/utils";

export const medicine = {
  id: "40000000-0000-4000-8000-000000000004", name: "Paracetamol", strength: "500mg", dosage_form: "Tablet", sku: "PC", barcode: "TEST-PC", base_unit: "tablet",
  selling_price: 7, available_quantity: 200, stock_status: "in_stock", packaging_status: "confirmed", is_active: true, nearest_expiry: "2098-12-25", expiring_soon: true,
  units: [{ unit_key: "base", label: "tablet", base_quantity: 1, selling_price: 7 }, { unit_key: "strip", label: "strip", base_quantity: 10, selling_price: 65 }, { unit_key: "box", label: "box", base_quantity: 100, selling_price: 620 }],
};
export const suppliers = [
  { id: "50000000-0000-4000-8000-000000000005", name: "City Medical Supplies", is_active: true, contact_person: "Ahmed", phone: "0300 0000000", email: "orders@city-medical-supplies.example.test" },
  { id: "50000000-0000-4000-8000-000000000006", name: "North Pharmacy Distributors", is_active: true },
  ...Array.from({ length: 15 }, (_, index) => ({ id: "50000000-0000-4000-8000-" + String(index + 10).padStart(12, "0"), name: "Supplier " + String(index + 1).padStart(2, "0"), is_active: true })),
];
export const saleItem = { id: "60000000-0000-4000-8000-000000000006", medicine_name: medicine.name, medicine_sku: "PC", quantity: 3, unit_label: "strip", base_units_per_sale_unit: 10, unit_price: 65, line_total: 195 };
export const sale = { id: "70000000-0000-4000-8000-000000000007", invoice_number: "QEI-TEST-0001", status: "completed", completed_at: localDateISO() + "T10:00:00Z", subtotal: 195, discount: 0, net_total: 195, profiles: { full_name: "Test Salesperson" }, sale_items: [saleItem], payments: [{ kind: "sale", method: "cash", amount: 195, change_amount: 5 }], sale_returns: [] };
const returnItem = { id: "80000000-0000-4000-8000-000000000008", quantity: 2, approved_quantity: 1, restockable: false, sale_items: saleItem };
export const purchase = { id: "90000000-0000-4000-8000-000000000009", purchase_number: "PUR-TEST-0001", supplier_invoice_number: "CITY-0001", invoice_date: localDateISO(), status: "draft", subtotal: 400, discount: 0, total: 400, suppliers: suppliers[0], purchase_items: [{ id: "purchase-item", batch_number: "BATCH-1", expiry_date: "2098-12-25", received_quantity: 2, received_unit: "box", base_units_per_received_unit: 100, quantity: 200, unit_cost: 2, line_total: 400, medicines: medicine }] };
export const metrics = { revenue: 45000, gross_profit: 12000, expenses: 3000, net_operating_result: 9000, sales_count: 20, total_medicines: 100, low_stock_items: 5, out_of_stock_items: 3, today_sales: 2400, today_transactions: 6 };
export const tables: Record<string, Record<string, unknown>[]> = {
  suppliers, sales: [sale], purchases: [purchase], medicines: [{ ...medicine, medicine_units: medicine.units }],
  medicine_batches: [{ id: "batch", batch_number: "BATCH-1", expiry_date: "2098-12-25", quantity_on_hand: 200, purchase_cost: 2, is_quarantined: false, medicines: medicine, suppliers: suppliers[0] }],
  medicine_costs: [{ default_purchase_cost: 2 }],
  sale_returns: [
    { id: "return-request", return_number: "RET-TEST-1", status: "requested", reason: "Customer returned one sealed strip", requested_at: sale.completed_at, sales: sale, profiles: sale.profiles, return_items: [returnItem] },
    { id: "return-approved", return_number: "RET-TEST-2", status: "approved", reason: "Damaged packaging", refund_amount: 65, requested_at: sale.completed_at, sales: sale, profiles: sale.profiles, return_items: [returnItem] },
  ],
  expense_categories: [{ id: "a0000000-0000-4000-8000-000000000001", name: "Utilities", is_active: true }],
  expenses: [{ id: "expense", amount: 3000, expense_date: localDateISO(), payee: "Electricity supplier", description: "Electricity bill", payment_method: "cash", expense_categories: { name: "Utilities" } }],
  profiles: [{ id: "staff", full_name: "Test Salesperson", is_active: true, created_at: sale.completed_at }],
  pharmacy_settings: [{ id: true, pharmacy_name: "Qeilvra Pharmacy", expiry_alert_days: 90, salesperson_max_discount_percent: 5, receipt_footer: "Thank you for shopping with us." }],
  medicine_categories: [{ id: "category", name: "General", is_active: true }],
  notifications: [{ id: "notification", title: "Low stock", message: "Open Inventory to check Paracetamol stock.", severity: "warning", action_url: "/medicines", created_at: sale.completed_at }],
};
