import { medicine, metrics, purchase, tables } from "./data";
import { localDateISO } from "@/lib/utils";
import { supplierFixtureTables } from "./supplier-data";
import { financialFixture } from "./financial-data";
import { financeRange } from "@/lib/financial-analytics";
import { stockFixtureTables } from "./stock-data";

class FixtureQuery {
  rows: Record<string, unknown>[];
  one = false;
  start = 0;
  end = Infinity;
  orders: { key: string; ascending: boolean }[] = [];
  constructor(table: string) {
    const profile = location.pathname.startsWith("/suppliers/") || (location.pathname.startsWith("/purchases/") && ![purchase.id, "new"].includes(location.pathname.split("/").at(-1)!));
    this.rows = [...((profile ? supplierFixtureTables() : tables)[table] ?? [])];
    if (new URLSearchParams(location.search).has("stock")) this.rows = [...(stockFixtureTables()[table] ?? this.rows)];
    if (table === "suppliers" && new URLSearchParams(location.search).get("suppliers") === "none") this.rows = [];
  }
  value(row: Record<string, unknown>, key: string): unknown { return key.replace(/\((\w+)\)/, ".$1").split(".").reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], row); }
  select() { return this; }
  eq(key: string, value: unknown) { this.rows = this.rows.filter((row) => this.value(row, key) === value); return this; }
  in(key: string, values: unknown[]) { this.rows = this.rows.filter((row) => values.includes(this.value(row, key))); return this; }
  gt(key: string, value: number) { this.rows = this.rows.filter((row) => Number(this.value(row, key)) > value); return this; }
  ilike(key: string, value: string) { this.rows = this.rows.filter((row) => String(row[key]).toLowerCase().includes(value.replaceAll("%", "").toLowerCase())); return this; }
  gte(key: string, value: string) { this.rows = this.rows.filter((row) => String(this.value(row, key)) >= value); return this; }
  lte() { return this; }
  order(key: string, options?: { ascending?: boolean }) { this.orders.push({ key, ascending: options?.ascending !== false }); return this; }
  limit(limit: number) { this.end = limit - 1; return this; }
  range(start: number, end: number) { this.start = start; this.end = end; return this; }
  or(filter: string, options?: { referencedTable?: string }) {
    this.rows = this.rows.filter((row) => filter.split(",").some((part) => {
      const [key, , pattern] = part.split(".");
      const value = String(this.value(row, options?.referencedTable ? options.referencedTable + "." + key : key) ?? "").toLowerCase();
      return (pattern ?? "").toLowerCase().split("%").filter(Boolean).every((word) => value.includes(word));
    })); return this;
  }
  single() { this.one = true; return this; }
  maybeSingle() { this.one = true; return this; }
  then(resolve: (value: unknown) => unknown) {
    this.rows.sort((a, b) => { for (const order of this.orders) { const result = String(this.value(a, order.key) ?? "").localeCompare(String(this.value(b, order.key) ?? "")); if (result) return order.ascending ? result : -result; } return 0; });
    return Promise.resolve(resolve({ data: this.one ? this.rows[0] ?? null : this.rows.slice(this.start, this.end + 1), error: null, count: this.rows.length }));
  }
}
export async function createClient() {
  return {
    from: (table: string) => new FixtureQuery(table),
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      if (name === "owner_financial_analytics") return { data: financialFixture({ ...financeRange(String(new URLSearchParams(location.search).get("period") ?? "today")), from: String(args.p_from), to: String(args.p_to), granularity: args.p_granularity as "hour" | "day" }, new URLSearchParams(location.search).has("empty")), error: null };
      if (name === "owner_dashboard_metrics" || name === "salesperson_dashboard") return { data: metrics, error: null };
      if (name === "owner_expense_total") return { data: metrics.expenses, error: null };
      if (name === "owner_sales_trend") return { data: [{ sale_date: localDateISO(), revenue: 45000, gross_profit: 12000, sale_count: 20 }], error: null };
      if (name === "owner_report_breakdowns") return { data: { medicine_sales: [{ medicine_id: medicine.id, medicine_name: medicine.name, quantity: 30, revenue: 195 }], salesperson_performance: [{ id: "staff", full_name: "Test Salesperson", sales_count: 20, revenue: 45000 }], purchase_total: 400, refund_total: 65, return_count: 1 }, error: null };
      if (name === "receipt_settings") return { data: tables.pharmacy_settings, error: null };
      if (name === "inventory_alerts") return { data: [{ medicine_id: medicine.id, medicine_name: medicine.name, sku: "PC", strength: "500mg", available_quantity: 3, reorder_level: 10, days_until_expiry: 12, expiry_date: "2098-12-25" }], error: null };
      const response = await fetch("/__test/inventory?" + new URLSearchParams(Object.fromEntries(Object.entries(args).map(([k, v]) => [k, String(v)]))));
      return { data: await response.json(), error: null };
    },
  };
}
