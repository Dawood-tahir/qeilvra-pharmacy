import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/search/route";
import type { AppRole } from "@/lib/permissions";

const { getCurrentStaff, createClient, from, filters } = vi.hoisted(() => ({
  getCurrentStaff: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  filters: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentStaff }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

const today = "2026-11-22";
const records: Record<string, object> = {
  medicines: { id: "med", name: "Aspirin", sku: "ASP", selling_price: 8 },
  sales: { id: "sale", invoice_number: "INV-R", completed_at: today, net_total: 10 },
  sale_returns: { id: "return", return_number: "RET 42", reason: "Repeat" },
  notifications: { id: "notification", title: "Records", message: "Reminder", action_url: "//external.invalid" },
  purchases: { id: "purchase", purchase_number: "PO-R", supplier_invoice_number: "SUP-R" },
  suppliers: { id: "supplier", name: "River Supplier", contact_person: "Robin" },
  medicine_batches: { id: "batch", medicine_id: "med", batch_number: "BATCH-R" },
  expenses: { id: "expense", description: "Rent", expense_date: today },
  profiles: { id: "staff", full_name: "Rana", phone: null },
  audit_logs: { id: "audit", action: "stock_received", entity_type: "medicine" },
};

beforeEach(() => {
  vi.resetAllMocks();
  createClient.mockResolvedValue({ from });
  from.mockImplementation((table: string) => {
    const request = {
      select: () => request, order: () => request, eq: () => request, in: () => request, limit: () => request,
      or: (pattern: string) => { filters(table, pattern); return request; },
      then: (resolve: (value: unknown) => void) => Promise.resolve(resolve({ data: [records[table]], error: null })),
    };
    return request;
  });
});

const request = () => new Request("http://localhost/api/search?q=R");

it("requires an active staff session before searching any records", async () => {
  getCurrentStaff.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect(createClient).not.toHaveBeenCalled();
});

it.each([
  ["salesperson", ["medicine", "invoice", "return", "notification"]],
  ["manager", ["medicine", "invoice", "return", "notification", "purchase", "supplier", "batch", "expense"]],
  ["owner", ["medicine", "invoice", "return", "notification", "purchase", "supplier", "batch", "expense", "staff", "audit"]],
] as [AppRole, string[]][])("honors page permissions for global search as %s", async (role, types) => {
  getCurrentStaff.mockResolvedValue({ id: "user", role });
  const result = await GET(request());
  expect(result.status).toBe(200);
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  const matches = await result.json();
  expect(matches.map((entry: { type: string }) => entry.type)).toEqual(types);
  expect(matches.find((entry: { type: string }) => entry.type === "return").href).toBe("/returns?q=RET+42");
  expect(matches.find((entry: { type: string }) => entry.type === "notification").href).toBe("/notifications?q=Records");
  expect(filters).toHaveBeenCalledTimes(types.length);
  expect(filters).toHaveBeenCalledWith("medicines", expect.stringContaining('name.imatch."R"'));
  expect(from.mock.calls.map(([name]) => name)).toEqual(Object.keys(records).slice(0, types.length));
});
