import { beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, rpc, from, range, or } = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), range: vi.fn(), or: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser }, rpc, from }) }));
import { GET } from "@/app/api/reports/export/route";
import { financialFixture } from "../ui/financial-data";
const request = (query = "type=sales&from=2026-10-01&to=2026-10-19") => new Request("https://qeilvra.test/api/reports/export?" + query);
const financialData = (data: Record<string, unknown>) => {
  const empty = financialFixture({ period: "custom", from: "2026-10-01", to: "2026-10-19", granularity: "day" }, true);
  return { ...empty, generated_at: "2026-10-19T12:00:00Z", ...data, metrics: { ...empty.metrics, ...(data.metrics as object) } };
};
beforeEach(() => {
  vi.resetAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
  rpc.mockResolvedValue({ data: "owner", error: null });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range, or };
  or.mockReturnValue(query);
  from.mockReturnValue(query);
  range.mockResolvedValue({ data: [], count: 0, error: null });
});
describe("complete Owner CSV exports", () => {
  it("exports financial totals and daily rows from the same analytics calculation", async () => {
    rpc.mockImplementation(async name => name === "current_role" ? { data: "owner" } : { data: financialData({ metrics: { sales_count: 1, gross_sales: 500, discounts: 50, refunds: 0, medicine_revenue: 450, extra_charge_revenue: 30, revenue: 480, cogs: 300, gross_profit: 180, expenses: 50, net_operating_profit: 130 }, daily: [] }) });
    const response = await GET(request("type=financials&from=2026-10-01&to=2026-10-19"));
    expect(response.status).toBe(200); const text = await response.text();
    expect(text).toContain('"Net Operating Profit"'); expect(text).toContain('"TOTAL","1","500","50","0","450","30","480","300","180","50","130"');
    expect(rpc).toHaveBeenCalledWith("owner_financial_analytics", { p_from: "2026-10-01", p_to: "2026-10-19", p_granularity: "day" });
  });
  it("rejects reversed dates before querying the database", async () => { expect((await GET(request("type=sales&from=2026-10-19&to=2026-10-01"))).status).toBe(400); expect(from).not.toHaveBeenCalled(); });
  it("exports stock losses and confirmed supplier recoveries separately from customer revenue", async () => {
    const metrics = { sales_count: 1, gross_sales: 500, discounts: 50, refunds: 0, medicine_revenue: 450, extra_charge_revenue: 30, revenue: 480, cogs: 300, gross_profit: 180, expenses: 50, net_operating_profit: 106, stock_written_off: 14, supplier_returns_value: 30, supplier_recoveries: 12, supplier_replacements_value: 8, net_inventory_loss: 24 };
    rpc.mockImplementation(async name => name === "current_role" ? { data: "owner" } : { data: financialData({ metrics, daily: [{ ...metrics, sale_date: "2026-10-19" }] }) });
    const csv = await (await GET(request("type=financials&from=2026-10-01&to=2026-10-19"))).text();
    expect(csv).toContain('"Confirmed Supplier Refunds/Credits","Replacement Stock Received","Net Inventory Loss"');
    expect(csv).toContain('"TOTAL","1","500","50","0","450","30","480","300","180","50","106","14","30","12","8","24"');
    expect(csv).toContain('"2026-10-19","1","500","50","0","450","30","480","300","180","50","106","14","30","12","8","24"');
  });
  it("exports posted receipt purchases separately without deducting them from financial results", async () => {
    const metrics = { sales_count: 0, revenue: 0, gross_profit: 0, expenses: 0, net_operating_profit: 0 };
    rpc.mockImplementation(async name => name === "current_role" ? { data: "owner" } : { data: financialData({ metrics, purchases_total: 9999, daily: [{ ...metrics, sale_date: "2026-10-19" }] }) });
    range.mockResolvedValue({ data: [{ id: "1", posted_at: "2026-10-19T08:00:00Z", total: "12.34" }], count: 1, error: null });
    const response = await GET(request("type=financials&from=2026-10-01&to=2026-10-19"));
    const csv = await response.text();
    expect(response.status).toBe(200);
    expect(csv).toContain('"Net Inventory Loss","Purchases Received"');
    expect(csv.trimEnd().split("\r\n").slice(1).every(row => row.endsWith(',"12.34"'))).toBe(true);
    expect(csv).not.toContain("9999");
    const query = from.mock.results[0].value;
    expect(query.eq).toHaveBeenCalledWith("status", "posted");
    expect(query.gte).toHaveBeenCalledWith("posted_at", "2026-10-01T00:00:00+05:00");
  });
  it("rejects a financial export when receipt completeness cannot be confirmed", async () => {
    rpc.mockImplementation(async name => name === "current_role" ? { data: "owner" } : { data: financialData({ metrics: {}, daily: [] }) });
    range.mockResolvedValue({ data: [], count: null, error: null });
    const response = await GET(request("type=financials&from=2026-10-01&to=2026-10-19"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toContain("Stock purchase figures could not load");
  });
  it("requires authentication", async () => { getUser.mockResolvedValue({ data: { user: null } }); expect((await GET(request())).status).toBe(401); expect(from).not.toHaveBeenCalled(); });
  it("does not expose purchase costs to Salespeople", async () => { rpc.mockResolvedValue({ data: "salesperson" }); expect((await GET(request("type=inventory&from=2026-10-01&to=2026-10-19"))).status).toBe(403); expect(from).not.toHaveBeenCalled(); });
  it("reports query failures instead of downloading an empty financial report", async () => { range.mockResolvedValue({ data: null, count: null, error: { message: "private SQL details" } }); const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private SQL"); });
  it("exports all rows even when the server caps each response below the requested page size", async () => {
    const rows = Array.from({ length: 1205 }, (_, id) => ({ id: String(id).padStart(12, "0"), completed_at: "2026-10-19T10:00:00+00:00", invoice_number: "QEI-" + id, net_total: 7, profiles: { full_name: id ? "Staff" : "  =1+1" } }));
    let after = "";
    or.mockImplementation(filter => { after = /id\.gt\.([^)]*)/.exec(filter)?.[1] ?? ""; return from.mock.results[0].value; });
    range.mockImplementation(async () => ({ data: rows.filter(row => row.id > after).slice(0, 200), count: rows.length, error: null }));
    const response = await GET(request()); const csv = await response.text();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(1206);
    expect(csv).toContain('"QEI-1204"'); expect(csv).toContain('"\'  =1+1"');
    expect(range).toHaveBeenCalledTimes(7); expect(or).toHaveBeenCalledTimes(6);
    expect(or.mock.calls[0][0]).toContain("id.gt.000000000199");
  });
  it("fails an interrupted stream rather than silently treating partial data as complete", async () => {
    range.mockResolvedValueOnce({ data: [{ id: "1", completed_at: "2026-10-19", invoice_number: "QEI-1" }], count: 2, error: null }).mockResolvedValueOnce({ data: null, error: { message: "connection lost" } });
    const response = await GET(request()); await expect(response.text()).rejects.toThrow("Export interrupted");
  });
  it("does not repeat invoices when another user inserts a backdated record between pages", async () => {
    const rows = [1,2,3].map(id => ({ id: String(id), completed_at: "2026-10-19", invoice_number: "QEI-" + id }));
    let after = "", calls = 0;
    or.mockImplementation(filter => { after = /id\.gt\.([^)]*)/.exec(filter)?.[1] ?? ""; return from.mock.results[0].value; });
    range.mockImplementation(async () => {
      if (++calls === 2) rows.unshift({ id: "0", completed_at: "2026-10-19", invoice_number: "QEI-NEW-BACKDATED" });
      return { data: rows.filter(row => row.id > after).slice(0, 1), count: rows.length, error: null };
    });
    const csv = await (await GET(request())).text();
    for (const id of [1,2,3]) expect(csv.split('"QEI-' + id + '"')).toHaveLength(2);
    expect(csv).not.toContain("QEI-NEW-BACKDATED");
  });
  it("rejects premature empty pages before the declared total", async () => {
    range.mockResolvedValueOnce({ data: [{ id: "1", completed_at: "2026-10-19", invoice_number: "QEI-1" }], count: 2, error: null }).mockResolvedValueOnce({ data: [], count: null, error: null });
    const response = await GET(request()); await expect(response.text()).rejects.toThrow("Export interrupted");
  });
});
