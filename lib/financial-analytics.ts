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
  extra_charge_revenue: number; revenue: number; cogs: number; gross_profit: number; expenses: number; net_operating_profit: number;
};
export type FinancialPoint = FinancialMetrics & { bucket_start: string; sale_date: string };
export type FinancialTrendPoint = Pick<FinancialPoint, "bucket_start" | "sale_date" | "revenue" | "gross_profit">;
export type FinancialSnapshot = {
  from: string; to: string; granularity: "hour" | "day"; generated_at: string;
  metrics: FinancialMetrics; trend: FinancialTrendPoint[]; daily: FinancialPoint[];
  medicines: { medicine_id: string; medicine_name: string; quantity: number; base_unit: string }[];
  expense_categories: { category: string; amount: number }[];
  salespeople?: { id: string; full_name: string; sales_count: number; revenue: number }[];
  purchases_total?: number;
  legacy_cost_estimates: number;
  inventory?: { total_medicines: number; low_stock_items: number; out_of_stock_items: number };
};
