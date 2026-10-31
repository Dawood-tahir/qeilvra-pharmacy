import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { financeRange, type FinancialSnapshot } from "@/lib/financial-analytics";
import { withReceiptPurchases } from "@/lib/purchase-analytics";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const staff = await requireStaff();
  const supabase = await createClient();
  const params = await searchParams;
  const range = financeRange(params.period);
  const owner = staff.role === "owner";
  const manager = staff.role === "manager";
  const [metricsResult, lowResult, expiringResult, salesResult] = await Promise.all([
    owner ? supabase.rpc("owner_financial_analytics", { p_from: range.from, p_to: range.to, p_granularity: range.granularity, p_include_inventory: true }) : supabase.rpc(manager ? "manager_dashboard" : "salesperson_dashboard"),
    supabase.rpc("inventory_alerts", { p_kind: "low_stock", p_limit: owner ? 6 : 5 }),
    supabase.rpc("inventory_alerts", { p_kind: "expiring", p_limit: owner ? 6 : 5 }),
    supabase.from("sales").select(manager ? "id,invoice_number,completed_at,status,sale_items(count),payments(method)" : "id,invoice_number,net_total,completed_at,status,sale_items(count),payments(method)").order("completed_at", { ascending: false }).limit(8).overrideTypes<Array<Record<string, unknown>>, { merge: false }>(),
  ]);
  if ([metricsResult, lowResult, expiringResult, salesResult].some(result => result.error)) throw new Error("Dashboard could not be loaded. Please retry.");
  if (owner && !metricsResult.data?.metrics) throw new Error("Financial figures could not be loaded. Please retry.");
  const recentSales = (salesResult.data ?? []).map((sale: Record<string, unknown>) => ({
    ...(manager ? { id: sale.id, invoice_number: sale.invoice_number, completed_at: sale.completed_at, status: sale.status } : sale),
    item_count: (sale.sale_items as { count: number }[] | undefined)?.[0]?.count ?? 0,
    payment_method: (sale.payments as { method: string }[] | undefined)?.[0]?.method,
  }));
  const financial = owner ? await withReceiptPurchases(supabase, metricsResult.data as FinancialSnapshot) : undefined;
  const metrics = manager ? {
    total_medicines: metricsResult.data.total_medicines,
    low_stock_items: metricsResult.data.low_stock_items,
    out_of_stock_items: metricsResult.data.out_of_stock_items,
    expiring_items: metricsResult.data.expiring_items,
  } : owner ? metricsResult.data.inventory : metricsResult.data;
  return <DashboardView role={staff.role} name={staff.fullName} metrics={metrics} financial={financial} range={range} lowStock={(lowResult.data ?? []) as never} expiring={(expiringResult.data ?? []) as never} recentSales={recentSales as never} />;
}
