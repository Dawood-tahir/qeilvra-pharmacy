import { beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, rpc } = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser }, rpc }) }));
import { GET } from "@/app/api/reports/analytics/route";
const request = (query = "period=today") => new Request("http://localhost/api/reports/analytics?" + query);
beforeEach(() => { vi.resetAllMocks(); getUser.mockResolvedValue({ data: { user: { id: "owner" } } }); rpc.mockResolvedValue({ data: { metrics: {}, trend: [] } }); });
describe("owner financial endpoint", () => {
  it("authenticates before querying figures", async () => { getUser.mockResolvedValue({ data: { user: null } }); expect((await GET(request())).status).toBe(401); expect(rpc).not.toHaveBeenCalled(); });
  it("denies salesperson access through the atomic database role guard", async () => { rpc.mockResolvedValue({ error: { code: "42501" } }); expect((await GET(request())).status).toBe(403); expect(rpc).toHaveBeenCalledTimes(1); });
  it("uses one financial RPC, returns fresh data and includes measured query timing", async () => { const response = await GET(request()); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("Server-Timing")).toMatch(/analytics;dur=/); expect(rpc).toHaveBeenCalledWith("owner_financial_analytics", expect.objectContaining({ p_granularity: "hour" })); });
  it("validates date ranges before authentication", async () => { expect((await GET(request("period=custom&from=invalid&to=2026-01-01"))).status).toBe(400); expect(getUser).not.toHaveBeenCalled(); });
  it("does not return fake zero totals on database failure", async () => { rpc.mockResolvedValue({ error: { message: "internal SQL" } }); const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("internal SQL"); });
});
