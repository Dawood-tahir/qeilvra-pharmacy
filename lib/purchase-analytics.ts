import type { createClient } from "@/lib/supabase/server";
import { assertFinancialAmounts, type FinancialSnapshot } from "@/lib/financial-analytics";
import { localDateISO } from "@/lib/utils";

type Client = Awaited<ReturnType<typeof createClient>>;
type Receipt = { id: string; posted_at: string; total: number | string };

// Call only after the Owner financial RPC succeeds. The session client also
// enforces purchases_owner_manage RLS; no service key or transaction mutation.
export async function withReceiptPurchases(client: Client, snapshot: FinancialSnapshot): Promise<FinancialSnapshot> {
  assertFinancialAmounts(snapshot);
  const end = new Date(snapshot.to + "T00:00:00+05:00");
  end.setUTCDate(end.getUTCDate() + 1);
  const totals = new Map<string, bigint>();
  let after: string | undefined;
  let expected: number | null = null;
  let received = 0;
  for (;;) {
    let query = client.from("purchases").select("id,posted_at,total", after ? undefined : { count: "exact" })
      .eq("status", "posted").gte("posted_at", snapshot.from + "T00:00:00+05:00")
      .lt("posted_at", end.toISOString()).lte("posted_at", snapshot.generated_at);
    if (after) query = query.gt("id", after);
    const { data, error, count } = await query.order("id").range(0, 499);
    if (error || (!after && count == null)) throw new Error("Stock purchase figures could not load. Please retry.");
    if (!after) expected = count;
    const rows = (data ?? []) as Receipt[];
    if (!rows.length && received < (expected ?? 0)) throw new Error("Stock purchase figures are incomplete. Please retry.");
    for (const row of rows) {
      // Purchase totals are numeric(14,2). Sum integer paisa so decimal rounding
      // never accumulates across receipts. Reject invalid data rather than show 0.
      const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(row.total));
      if (!match || (after && row.id <= after)) throw new Error("Stock purchase figures could not be verified. Please retry.");
      const amount = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
      const date = localDateISO(new Date(row.posted_at));
      totals.set(date, (totals.get(date) ?? 0n) + amount);
      after = row.id;
    }
    received += rows.length;
    if (received > (expected ?? 0)) throw new Error("Stock purchase figures changed while loading. Please retry.");
    if (received >= (expected ?? 0)) break;
  }
  const amount = (value: bigint) => {
    if (value >= BigInt(2 ** 45) * 100n) throw new Error("Stock purchase total is too large to display accurately.");
    return Number(value) / 100;
  };
  return {
    ...snapshot,
    purchases_total: amount([...totals.values()].reduce((sum, value) => sum + value, 0n)),
    purchases_count: received,
    daily: snapshot.daily.map(day => ({ ...day, purchases: amount(totals.get(day.sale_date) ?? 0n) })),
  };
}
