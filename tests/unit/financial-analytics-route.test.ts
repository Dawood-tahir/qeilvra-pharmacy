import { beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, rpc, from, receiptRows } = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), receiptRows: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser }, rpc, from }) }));
import { GET } from "@/app/api/reports/analytics/route";
const request = (query = "period=today") => new Request("http://localhost/api/reports/analytics?" + query);
beforeEach(() => {
  vi.resetAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
  rpc.mockResolvedValue({ data: { from: "2026-01-01", to: "2026-01-01", generated_at: "2026-01-01T12:00:00Z", metrics: {}, trend: [], daily: [{ sale_date: "2026-01-01" }] } });
  receiptRows.mockResolvedValue({ data: [{ id: "receipt-1", posted_at: "2026-01-01T08:00:00Z", total: "12500.25" }], count: 1, error: null });
  const query = { select: () => query, eq: () => query, gte: () => query, lt: () => query, lte: () => query, order: () => query, range: receiptRows };
  from.mockReturnValue(query);
});
describe("owner financial endpoint", () => {
  it("authenticates before querying figures", async () => { getUser.mockResolvedValue({ data: { user: null } }); expect((await GET(request())).status).toBe(401); expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled(); });
  it("denies salesperson access before reading purchase records", async () => { rpc.mockResolvedValue({ error: { code: "42501" } }); expect((await GET(request())).status).toBe(403); expect(rpc).toHaveBeenCalledTimes(1); expect(from).not.toHaveBeenCalled(); });
  it("uses one financial RPC, supplements receipt purchases and includes measured query timing", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Server-Timing")).toMatch(/analytics;dur=/);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("owner_financial_analytics", expect.objectContaining({ p_granularity: "hour" }));
    expect(from).toHaveBeenCalledWith("purchases");
    expect(await response.json()).toMatchObject({ purchases_total: 12500.25, purchases_count: 1, daily: [{ purchases: 12500.25 }] });
  });
  it("validates date ranges before authentication", async () => { expect((await GET(request("period=custom&from=invalid&to=2026-01-01"))).status).toBe(400); expect(getUser).not.toHaveBeenCalled(); });
  it("does not return fake zero totals on database failure", async () => { rpc.mockResolvedValue({ error: { message: "internal SQL" } }); const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("internal SQL"); });
  it("reports receipt-query failure without publishing incomplete financial figures", async () => {
    receiptRows.mockResolvedValue({ data: null, error: { message: "private database detail" } });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "Stock purchase figures could not load. Please retry." });
  });
});
