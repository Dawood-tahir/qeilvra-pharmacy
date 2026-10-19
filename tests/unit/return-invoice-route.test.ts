import { beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, rpc } = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser }, rpc }) }));
import { GET } from "@/app/api/returns/invoice/route";
const request = (q: string) => new Request("http://localhost/api/returns/invoice?q=" + encodeURIComponent(q));
beforeEach(() => {
  vi.resetAllMocks(); getUser.mockResolvedValue({ data: { user: { id: "staff" } } });
  rpc.mockResolvedValue({ data: [{ id: "invoice", invoice_number: "QEI-123" }], error: null });
});
describe("POS invoice lookup", () => {
  it("requires authentication before reading invoices", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(request("QEI-123"))).status).toBe(401); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["", "Paracetamol 500mg", "QEI-123", "%", "QEI,created_by.eq.other"])("passes search as a literal RPC argument: %s", async (q) => {
    expect((await GET(request(q))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("return_sales", expect.objectContaining({ p_query: q, p_limit: 11, p_offset: 0 }));
  });
  it("does not cache role-scoped financial results", async () => {
    const response = await GET(request("QEI-123"));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ sales: [{ id: "invoice", invoice_number: "QEI-123" }], hasMore: false });
  });
  it("does not disguise a database failure as a missing invoice", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    expect((await GET(request("QEI-123"))).status).toBe(503);
  });
  it("validates dates and passes pagination to the scoped lookup", async () => {
    expect((await GET(new Request("http://localhost/api/returns/invoice?date=invalid"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/returns/invoice?page=-1"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/returns/invoice?q=" + "a".repeat(101)))).status).toBe(400);
    await GET(new Request("http://localhost/api/returns/invoice?date=2026-10-19&page=2"));
    expect(rpc).toHaveBeenCalledWith("return_sales", expect.objectContaining({ p_date: "2026-10-19", p_offset: 10 }));
  });
});
