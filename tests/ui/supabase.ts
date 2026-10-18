import { medicine, metrics, tables } from "./data";
import { localDateISO } from "@/lib/utils";

class FixtureQuery {
  rows: Record<string, unknown>[];
  one = false;
  constructor(table: string) { this.rows = [...(tables[table] ?? [])]; }
  select() { return this; }
  eq(key: string, value: unknown) { if (!key.includes(".")) this.rows = this.rows.filter((row) => row[key] === value); return this; }
  ilike(key: string, value: string) { this.rows = this.rows.filter((row) => String(row[key]).toLowerCase().includes(value.replaceAll("%", "").toLowerCase())); return this; }
  gte() { return this; }
  lte() { return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  or() { return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.one = true; return this; }
  then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: this.one ? this.rows[0] ?? null : this.rows, error: null, count: this.rows.length })); }
}
export async function createClient() {
  return {
    from: (table: string) => new FixtureQuery(table),
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      if (name === "owner_dashboard_metrics" || name === "salesperson_dashboard") return { data: metrics, error: null };
      if (name === "owner_sales_trend") return { data: [{ sale_date: localDateISO(), revenue: 45000, gross_profit: 12000, sale_count: 20 }], error: null };
      if (name === "owner_report_breakdowns") return { data: { medicine_sales: [{ medicine_id: medicine.id, medicine_name: medicine.name, quantity: 30, revenue: 195 }], salesperson_performance: [{ id: "staff", full_name: "Test Salesperson", sales_count: 20, revenue: 45000 }], purchase_total: 400, refund_total: 65, return_count: 1 }, error: null };
      if (name === "receipt_settings") return { data: tables.pharmacy_settings, error: null };
      if (name === "inventory_alerts") return { data: [{ medicine_id: medicine.id, medicine_name: medicine.name, sku: "PC", strength: "500mg", available_quantity: 3, reorder_level: 10, days_until_expiry: 12, expiry_date: "2098-12-25" }], error: null };
      const response = await fetch("/__test/inventory?" + new URLSearchParams(Object.fromEntries(Object.entries(args).map(([k, v]) => [k, String(v)]))));
      return { data: await response.json(), error: null };
    },
  };
}
