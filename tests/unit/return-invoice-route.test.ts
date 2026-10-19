import { beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, from, limit } = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser }, from }) }));
import { GET } from "@/app/api/returns/invoice/route";
const request = (q: string) => new Request("http://localhost/api/returns/invoice?q=" + encodeURIComponent(q));
beforeEach(() => {
  vi.resetAllMocks(); getUser.mockResolvedValue({ data: { user: { id: "staff" } } });
  from.mockReturnValue({ select: () => ({ ilike: () => ({ order: () => ({ limit }) }) }) });
  limit.mockResolvedValue({ data: [{ id: "invoice", invoice_number: "QEI-123" }], error: null });
});
describe("POS invoice lookup", () => {
  it("requires authentication before reading invoices", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(request("QEI-123"))).status).toBe(401); expect(from).not.toHaveBeenCalled();
  });
  it.each(["", "ab", "%", "QEI%", "QEI,created_by.eq.other"])("rejects unsafe or broad search %s", async (q) => {
    expect((await GET(request(q))).status).toBe(400); expect(from).not.toHaveBeenCalled();
  });
  it("does not cache role-scoped financial results", async () => {
    const response = await GET(request("QEI-123"));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual([{ id: "invoice", invoice_number: "QEI-123" }]);
  });
  it("does not disguise a database failure as a missing invoice", async () => {
    limit.mockResolvedValue({ data: null, error: { message: "offline" } });
    expect((await GET(request("QEI-123"))).status).toBe(503);
  });
});
