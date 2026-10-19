import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { localDateISO } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

function periodDates(period: string) {
  const today = new Date(`${localDateISO()}T12:00:00+05:00`);
  const to = localDateISO(today);
  const fromDate = new Date(today);
  if (period === "month") fromDate.setDate(1);
  else fromDate.setDate(fromDate.getDate() - (period === "30d" ? 29 : 6));
  return { from: localDateISO(fromDate), to };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const staff = await requireStaff();
  const supabase = await createClient();
  const params = await searchParams;
  const period = ["7d", "30d", "month"].includes(params.period ?? "") ? params.period! : "7d";
  const dates = periodDates(period);
  const today = localDateISO();

  if (staff.role === "owner") {
    const [metricsResult, todayResult, trendResult, lowResult, expiringResult, salesResult] = await Promise.all([
      supabase.rpc("owner_dashboard_metrics", { p_from: dates.from, p_to: dates.to }),
      supabase.rpc("owner_dashboard_metrics", { p_from: today, p_to: today }),
      supabase.rpc("owner_sales_trend", { p_from: dates.from, p_to: dates.to }),
      supabase.rpc("inventory_alerts", { p_kind: "low_stock", p_limit: 6 }),
      supabase.rpc("inventory_alerts", { p_kind: "expiring", p_limit: 6 }),
      supabase.from("sales").select("id,invoice_number,net_total,completed_at,status,sale_items(count),payments(method)").order("completed_at", { ascending: false }).limit(8),
    ]);
    if ([metricsResult, todayResult, trendResult, lowResult, expiringResult, salesResult].some(result => result.error)) throw new Error("Dashboard could not be loaded. Please try again.");
    if ([metricsResult, lowResult, expiringResult, salesResult].some(result => result.error)) throw new Error("Dashboard could not be loaded. Please try again.");
  const recentSales = (salesResult.data ?? []).map((sale: Record<string, unknown>) => ({
      ...sale,
      item_count: (sale.sale_items as { count: number }[] | undefined)?.[0]?.count ?? 0,
      payment_method: (sale.payments as { method: string }[] | undefined)?.[0]?.method,
    }));
    return <DashboardView role={staff.role} name={staff.fullName} metrics={(metricsResult.data ?? {}) as never} todaySales={Number((todayResult.data as { revenue?: number } | null)?.revenue ?? 0)} trend={(trendResult.data ?? []) as never} lowStock={(lowResult.data ?? []) as never} expiring={(expiringResult.data ?? []) as never} recentSales={recentSales as never} period={period} />;
  }

  const [metricsResult, lowResult, expiringResult, salesResult] = await Promise.all([
    supabase.rpc("salesperson_dashboard"),
    supabase.rpc("inventory_alerts", { p_kind: "low_stock", p_limit: 5 }),
    supabase.rpc("inventory_alerts", { p_kind: "expiring", p_limit: 5 }),
    supabase.from("sales").select("id,invoice_number,net_total,completed_at,status,sale_items(count),payments(method)").order("completed_at", { ascending: false }).limit(8),
  ]);
  const recentSales = (salesResult.data ?? []).map((sale: Record<string, unknown>) => ({ ...sale, item_count: (sale.sale_items as { count: number }[] | undefined)?.[0]?.count ?? 0, payment_method: (sale.payments as { method: string }[] | undefined)?.[0]?.method }));
  return <DashboardView role={staff.role} name={staff.fullName} metrics={(metricsResult.data ?? {}) as never} todaySales={0} trend={[]} lowStock={(lowResult.data ?? []) as never} expiring={(expiringResult.data ?? []) as never} recentSales={recentSales as never} period="7d" />;
}
