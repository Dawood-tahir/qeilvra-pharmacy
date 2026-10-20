import { describe, expect, it, vi } from "vitest";
import { withReceiptPurchases } from "@/lib/purchase-analytics";
import type { FinancialSnapshot } from "@/lib/financial-analytics";
import { financialFixture } from "../ui/financial-data";

type Purchase = { id: string; status: "posted" | "draft"; posted_at: string | null; invoice_date: string; total: string | number };
const snapshot = (): FinancialSnapshot => ({
  ...financialFixture({ period: "custom", from: "2026-10-19", to: "2026-10-20", granularity: "day" }),
  generated_at: "2026-10-20T18:00:00Z",
  daily: ["2026-10-19", "2026-10-20"].map(sale_date => ({ ...financialFixture({ period: "today", from: sale_date, to: sale_date, granularity: "hour" }).daily[0], sale_date })),
});
const purchase = (id: string, overrides: Partial<Purchase> = {}): Purchase => ({ id, status: "posted", posted_at: "2026-10-20T08:00:00Z", invoice_date: "2026-10-20", total: "1.00", ...overrides });

// Apply the actual query filters so these tests verify which saved purchase
// headers contribute, rather than returning every fixture regardless of query.
function clientFor(rows: Purchase[], cap = 500) {
  const calls: { operation: string; field?: string; value?: unknown }[] = [];
  const from = vi.fn((table: string) => {
    expect(table).toBe("purchases");
    let selected = rows.slice();
    let counted = false;
    const query = {
      select(fields: string, options?: { count: string }) { expect(fields).toBe("id,posted_at,total"); counted = options?.count === "exact"; return query; },
      eq(field: keyof Purchase, value: string) { calls.push({ operation: "eq", field, value }); selected = selected.filter(row => row[field] === value); return query; },
      gte(field: keyof Purchase, value: string) { calls.push({ operation: "gte", field, value }); selected = selected.filter(row => row[field] != null && Date.parse(String(row[field])) >= Date.parse(value)); return query; },
      lt(field: keyof Purchase, value: string) { calls.push({ operation: "lt", field, value }); selected = selected.filter(row => row[field] != null && Date.parse(String(row[field])) < Date.parse(value)); return query; },
      lte(field: keyof Purchase, value: string) { calls.push({ operation: "lte", field, value }); selected = selected.filter(row => row[field] != null && Date.parse(String(row[field])) <= Date.parse(value)); return query; },
      gt(field: keyof Purchase, value: string) { calls.push({ operation: "gt", field, value }); selected = selected.filter(row => row[field] != null && String(row[field]) > value); return query; },
      order(field: keyof Purchase) { selected.sort((a, b) => String(a[field]).localeCompare(String(b[field]))); return query; },
      range: vi.fn(async (start: number, end: number) => ({ data: selected.slice(start, Math.min(end + 1, start + cap)), error: null, count: counted ? selected.length : null })),
    };
    return query;
  });
  return { client: { from } as unknown as Parameters<typeof withReceiptPurchases>[0], from, calls };
}

describe("posted stock receipt purchase analytics", () => {
  it("counts posted initial stock, restocks and supplier invoices once by receipt date, excluding drafts", async () => {
    const { client, calls } = clientFor([
      purchase("1", { invoice_date: "2026-09-01", total: "10.10" }),
      purchase("2", { total: "20.20" }),
      purchase("3", { total: "30.30" }),
      purchase("4", { status: "draft", posted_at: null, total: "9000.00" }),
      purchase("5", { invoice_date: "2026-10-20", posted_at: "2026-10-18T08:00:00Z", total: "7000.00" }),
    ]);
    const result = await withReceiptPurchases(client, snapshot());
    expect(result.purchases_total).toBe(60.6);
    expect(result.purchases_count).toBe(3);
    expect(result.daily.map(day => day.purchases)).toEqual([0, 60.6]);
    expect(calls).toContainEqual({ operation: "eq", field: "status", value: "posted" });
    expect(calls.some(call => call.field === "invoice_date")).toBe(false);
    expect(result.metrics).toEqual(snapshot().metrics);
  });

  it("uses inclusive Karachi midnight, exclusive next midnight and the snapshot timestamp", async () => {
    const data = snapshot(); data.generated_at = "2026-10-20T19:00:00Z";
    const { client, calls } = clientFor([
      purchase("1", { posted_at: "2026-10-18T18:59:59.999Z", total: "100" }),
      purchase("2", { posted_at: "2026-10-18T19:00:00.000Z", total: "1" }),
      purchase("3", { posted_at: "2026-10-19T18:59:59.999Z", total: "2" }),
      purchase("4", { posted_at: "2026-10-19T19:00:00.000Z", total: "3" }),
      purchase("5", { posted_at: "2026-10-20T18:59:59.999Z", total: "4" }),
      purchase("6", { posted_at: "2026-10-20T19:00:00.000Z", total: "200" }),
    ]);
    const result = await withReceiptPurchases(client, data);
    expect(result.purchases_total).toBe(10);
    expect(result.daily.map(day => day.purchases)).toEqual([3, 7]);
    expect(calls).toContainEqual({ operation: "gte", field: "posted_at", value: "2026-10-19T00:00:00+05:00" });
    expect(calls).toContainEqual({ operation: "lt", field: "posted_at", value: "2026-10-20T19:00:00.000Z" });
    const { client: current } = clientFor([purchase("1", { posted_at: snapshot().generated_at, total: "1.23" }), purchase("2", { posted_at: "2026-10-20T18:00:00.001Z", total: "100" })]);
    expect((await withReceiptPurchases(current, snapshot())).purchases_total).toBe(1.23);
  });

  it("seeks across more than 500 receipts and respects a smaller server response cap", async () => {
    const rows = Array.from({ length: 1205 }, (_, index) => purchase(String(index + 1).padStart(5, "0"), { total: "0.01" }));
    const { client, from, calls } = clientFor(rows, 200);
    const result = await withReceiptPurchases(client, snapshot());
    expect(result.purchases_count).toBe(1205);
    expect(result.purchases_total).toBe(12.05);
    expect(from).toHaveBeenCalledTimes(7);
    expect(calls.filter(call => call.operation === "gt").map(call => call.value)).toEqual(["00200", "00400", "00600", "00800", "01000", "01200"]);
  });

  it("returns real zero totals for an empty period and preserves confirmed financial metrics", async () => {
    const { client } = clientFor([]); const data = snapshot();
    expect(await withReceiptPurchases(client, data)).toMatchObject({ purchases_total: 0, purchases_count: 0, metrics: data.metrics, daily: data.daily.map(day => ({ ...day, purchases: 0 })) });
  });

  it.each(["-1.00", "1.001", "NaN", "Infinity", "", "90071992547410.00"])("rejects invalid or unsafe totals %s", async total => {
    const { client } = clientFor([purchase("1", { total })]);
    await expect(withReceiptPurchases(client, snapshot())).rejects.toThrow();
  });

  it.each([
    [{ data: null, error: { code: "42501" }, count: null }],
    [{ data: [], error: null, count: null }],
    [{ data: [purchase("1")], error: null, count: 2 }, { data: [], error: null, count: null }],
    [{ data: [purchase("1"), purchase("2")], error: null, count: 1 }],
    [{ data: [purchase("2"), purchase("1")], error: null, count: 2 }],
  ].map(responses => ({ responses })))("rejects inaccessible, incomplete or inconsistent receipt pages %#", async ({ responses }) => {
    const range = vi.fn(); for (const response of responses) range.mockResolvedValueOnce(response);
    const query = { select: () => query, eq: () => query, gte: () => query, lt: () => query, lte: () => query, gt: () => query, order: () => query, range };
    await expect(withReceiptPurchases({ from: () => query } as unknown as Parameters<typeof withReceiptPurchases>[0], snapshot())).rejects.toThrow();
  });
});
