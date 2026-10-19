import { financeRange, type FinanceRange, type FinancialSnapshot } from "@/lib/financial-analytics";

export function financialFixture(range: FinanceRange = financeRange("today"), empty = false): FinancialSnapshot {
  const metrics = { sales_count: empty ? 0 : 20, gross_sales: empty ? 0 : 50000, discounts: empty ? 0 : 2000, refunds: empty ? 0 : 1000, medicine_revenue: empty ? 0 : 47000, extra_charge_revenue: empty ? 0 : 500, revenue: empty ? 0 : 47500, cogs: empty ? 0 : 30000, gross_profit: empty ? 0 : 17500, expenses: empty ? 0 : 20000, net_operating_profit: empty ? 0 : -2500, stock_written_off: 0, supplier_returns_value: 0, supplier_recoveries: 0, supplier_replacements_value: 0, net_inventory_loss: 0 };
  const point = { ...metrics, bucket_start: range.to + "T00:00:00+05:00", sale_date: range.to };
  return { from: range.from, to: range.to, granularity: range.granularity, generated_at: new Date().toISOString(), metrics, trend: [point], daily: [point], medicines: empty ? [] : [{ medicine_id: "test-medicine", medicine_name: "Paracetamol 500mg", quantity: 40, base_unit: "tablet" }], expense_categories: empty ? [] : [{ category: "Rent", amount: 15000 }, { category: "Utilities", amount: 5000 }], legacy_cost_estimates: 0, inventory: { total_medicines: 100, low_stock_items: 5, out_of_stock_items: 3 } };
}
