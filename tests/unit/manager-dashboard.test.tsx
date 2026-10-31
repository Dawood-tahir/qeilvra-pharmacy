import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, select, createClient, withReceiptPurchases } = vi.hoisted(() => ({ rpc: vi.fn(), select: vi.fn(), createClient: vi.fn(), withReceiptPurchases: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireStaff: async () => ({ role: "manager", id: "manager", fullName: "Manager" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/purchase-analytics", () => ({ withReceiptPurchases }));
vi.mock("@/components/dashboard/dashboard-view", () => ({ DashboardView: () => null }));
import DashboardPage from "@/app/(app)/dashboard/page";
beforeEach(() => {
  vi.resetAllMocks();
  rpc.mockImplementation(async name => ({ data: name === "manager_dashboard" ? { total_medicines: 3, low_stock_items: 1, out_of_stock_items: 0, expiring_items: 1, revenue: 987654, gross_profit: 777777 } : [], error: null }));
  const query = { select, order: () => query, limit: () => query, overrideTypes: async () => ({ data: [{ id: "sale", invoice_number: "INVOICE", net_total: 999999, completed_at: "2026-10-25", status: "completed", sale_items: [{ count: 1 }], payments: [{ method: "cash" }] }], error: null }) };
  select.mockReturnValue(query);
  createClient.mockResolvedValue({ rpc, from: () => query });
});
describe("Manager dashboard data minimization", () => {
  it("does not query financial RPCs, purchase totals or invoice amounts", async () => {
    const page = await DashboardPage({ searchParams: Promise.resolve({}) });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["manager_dashboard", "inventory_alerts", "inventory_alerts"]);
    expect(select).toHaveBeenCalledWith("id,invoice_number,completed_at,status,sale_items(count),payments(method)");
    expect(withReceiptPurchases).not.toHaveBeenCalled();
    expect(page.props.financial).toBeUndefined();
    expect(page.props.metrics).toEqual({ total_medicines: 3, low_stock_items: 1, out_of_stock_items: 0, expiring_items: 1 });
    expect(page.props.recentSales[0]).not.toHaveProperty("net_total");
    expect(JSON.stringify(page.props)).not.toMatch(/987654|777777|999999/);
  });
});
