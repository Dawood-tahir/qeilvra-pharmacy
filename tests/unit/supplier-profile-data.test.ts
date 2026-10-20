import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireOwner, createClient, rpc, calls, fixture } = vi.hoisted(() => ({
  requireOwner: vi.fn(), createClient: vi.fn(), rpc: vi.fn(), calls: [] as { table: string; select: string; filters: [string, unknown][]; start: number; end: number }[],
  fixture: { summaries: [] as Record<string, unknown>[], error: false },
}));
vi.mock("@/lib/auth", () => ({ requireOwner }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
import { loadSupplierProfile } from "@/lib/supplier-profile-data";

const options = { tab: "overview", query: "", page: 1, status: "all" };
const id = "supplier";
beforeEach(() => {
  vi.resetAllMocks(); calls.length = 0; fixture.summaries = []; fixture.error = false;
  requireOwner.mockResolvedValue({ role: "owner" });
  rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
  createClient.mockResolvedValue({ rpc, from: (table: string) => {
    const call = { table, select: "", filters: [] as [string, unknown][], start: 0, end: 199 }; calls.push(call);
    const query = {
      select: (fields: string) => { call.select = fields; return query; },
      eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query; },
      in: (key: string, value: unknown) => { call.filters.push([key, value]); return query; },
      gt: () => query, gte: () => query, order: () => query, or: () => query,
      range: (start: number, end: number) => { call.start = start; call.end = end; return query; },
      single: () => query, maybeSingle: () => query,
      then: (resolve: (result: unknown) => unknown) => {
        if (table === "suppliers") return Promise.resolve(resolve({ data: { id, name: "Saved supplier" }, error: null }));
        if (table === "pharmacy_settings") return Promise.resolve(resolve({ data: { expiry_alert_days: 60 }, error: null }));
        if (table === "purchases" && call.select.includes("purchase_items(medicine_id)")) return Promise.resolve(resolve({ data: fixture.summaries.slice(call.start, call.end + 1), error: fixture.error ? { message: "unavailable" } : null }));
        return Promise.resolve(resolve({ data: [], error: null, count: 0 }));
      },
    }; return query;
  } });
});

describe("Owner-only supplier data loading", () => {
  it("uses the summary RPC without downloading receipt history and keeps history paginated", async () => {
    rpc.mockResolvedValue({ data: { total: 2050, deliveries: 205, medicineCount: 1, drafts: 1, lastPurchase: "2026-10-19", lastPurchases: {} }, error: null });
    const result = await loadSupplierProfile(id, { ...options, tab: "history", page: 2 });
    expect(result?.summary.total).toBe(2050);
    expect(rpc).toHaveBeenCalledWith("supplier_purchase_summary", { p_supplier_id: id, p_include_medicines: false });
    expect(calls.some(call => call.select.includes("purchase_items(medicine_id)"))).toBe(false);
    expect(calls.find(call => call.table === "purchases")).toMatchObject({ start: 12, end: 23 });
  });
  it("does not mask RPC permission errors with a history scan", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(loadSupplierProfile(id, options)).rejects.toThrow("Supplier records could not be loaded");
    expect(calls.some(call => call.select.includes("purchase_items(medicine_id)"))).toBe(false);
  });
  it("checks authorization before accessing any financial records", async () => {
    requireOwner.mockRejectedValue(new Error("Owner required"));
    await expect(loadSupplierProfile(id, options)).rejects.toThrow("Owner required");
    expect(createClient).not.toHaveBeenCalled();
  });
  it("ranges through all summary rows instead of truncating totals at the response cap", async () => {
    fixture.summaries = Array.from({ length: 205 }, (_, index) => ({ id: String(index), supplier_id: id, invoice_date: "2026-10-19", status: "posted", total: 10, purchase_items: [{ medicine_id: "medicine" }] }));
    const result = await loadSupplierProfile(id, options);
    expect(result?.summary).toMatchObject({ total: 2050, deliveries: 205, medicineCount: 1 });
    expect(calls.filter((call) => call.select.includes("purchase_items(medicine_id)")).map((call) => [call.start, call.end])).toEqual([[0, 199], [200, 399]]);
    expect(calls.filter((call) => call.table === "purchases").every((call) => call.filters.some(([key, value]) => key === "supplier_id" && value === id))).toBe(true);
    const deliveries = calls.find((call) => call.table === "purchase_items")!;
    expect(deliveries.filters).toContainEqual(["purchases.supplier_id", id]);
    expect(deliveries.filters).toContainEqual(["purchases.status", "posted"]);
    const stock = calls.find((call) => call.table === "medicine_batches")!;
    expect(stock.filters).toContainEqual(["medicine_id", ["medicine"]]);
    expect(stock.filters.some(([key]) => key === "supplier_id")).toBe(false);
  });
  it("surfaces database errors instead of showing misleading zero totals", async () => {
    fixture.error = true;
    await expect(loadSupplierProfile(id, options)).rejects.toThrow("Supplier records could not be loaded");
  });
  it("does not query inventory for suppliers without received purchases", async () => {
    const result = await loadSupplierProfile(id, options);
    expect(result?.alerts).toEqual([]);
    expect(calls.some((call) => ["medicines", "medicine_batches", "pharmacy_settings"].includes(call.table))).toBe(false);
  });
});
