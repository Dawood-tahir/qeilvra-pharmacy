import { z } from "zod";
import { localDateISO } from "@/lib/utils";

export type FinancePeriod = "today" | "week" | "month" | "custom";
export type FinanceRange = { period: FinancePeriod; from: string; to: string; granularity: "hour" | "day" };
export function financeRange(period: string = "today", from?: string, to?: string, now = new Date()): FinanceRange {
  const today = localDateISO(now);
  if (period === "custom") {
    const parsed = z.object({ from: z.iso.date(), to: z.iso.date() }).safeParse({ from, to });
    if (!parsed.success || parsed.data.from > parsed.data.to || parsed.data.to > today || (Date.parse(parsed.data.to) - Date.parse(parsed.data.from)) / 86400000 > 365) throw new Error("Choose valid dates, up to one year, ending today or earlier.");
    return { period: "custom", ...parsed.data, granularity: "day" };
  }
  const selected = period === "week" || period === "month" ? period : "today";
  const start = new Date(today + "T00:00:00Z");
  if (selected === "week") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (selected === "month") start.setUTCDate(1);
  return { period: selected, from: start.toISOString().slice(0, 10), to: today, granularity: selected === "today" ? "hour" : "day" };
}

export type FinancialMetrics = {
  sales_count: number; gross_sales: number; discounts: number; refunds: number; medicine_revenue: number;
  extra_charge_revenue: number; revenue: number; cogs: number; gross_profit: number; expenses: number; net_operating_profit: number; stock_written_off: number; supplier_returns_value: number; supplier_recoveries: number; supplier_replacements_value: number; net_inventory_loss: number;
};
export type FinancialPoint = FinancialMetrics & { bucket_start: string; sale_date: string; purchases?: number };
export type FinancialTrendPoint = Pick<FinancialPoint, "bucket_start" | "sale_date" | "revenue" | "gross_profit">;
export type FinancialSnapshot = {
  from: string; to: string; granularity: "hour" | "day"; generated_at: string;
  metrics: FinancialMetrics; trend: FinancialTrendPoint[]; daily: FinancialPoint[];
  medicines: { medicine_id: string; medicine_name: string; quantity: number; base_unit: string }[];
  expense_categories: { category: string; amount: number }[];
  salespeople?: { id: string; full_name: string; sales_count: number; revenue: number }[];
  purchases_total?: number;
  purchases_count?: number;
  legacy_cost_estimates: number;
  inventory?: { total_medicines: number; low_stock_items: number; out_of_stock_items: number };
};

const moneyFields = ["gross_sales", "discounts", "refunds", "medicine_revenue", "extra_charge_revenue", "revenue", "cogs", "gross_profit", "expenses", "net_operating_profit", "stock_written_off", "supplier_returns_value", "supplier_recoveries", "supplier_replacements_value", "net_inventory_loss"] as const;
// Keep a conservative margin below the IEEE-754 cent-precision boundary.
// PostgreSQL keeps the exact ledger; refuse an unsafe numeric API response.
export function assertFinancialAmounts(snapshot: FinancialSnapshot) {
  const verify = (amount: unknown) => {
    if (typeof amount !== "number" || !Number.isFinite(amount) || Math.abs(amount) >= 2 ** 45 || !/^-?\d+(?:\.\d{1,2})?$/.test(String(amount))) {
      throw new Error("Financial amounts are missing or cannot be displayed accurately.");
    }
  };
  for (const key of moneyFields) verify(snapshot.metrics[key]);
  for (const point of [...snapshot.daily, ...snapshot.trend]) {
    for (const key of moneyFields) if (key in point && point[key as keyof typeof point] != null) verify(point[key as keyof typeof point]);
  }
  for (const category of snapshot.expense_categories) verify(category.amount);
  for (const person of snapshot.salespeople ?? []) verify(person.revenue);
}
