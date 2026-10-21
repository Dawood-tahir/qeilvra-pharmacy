import { beforeEach, describe, expect, it, vi } from "vitest";
const { insert, requireOwner } = vi.hoisted(() => ({ insert: vi.fn(), requireOwner: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireOwner }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => ({ insert }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { createExpenseAction } from "@/app/(app)/expenses/actions";
const form = (amount: string) => {
  const result = new FormData();
  for (const [key, value] of Object.entries({ category_id: "f2000000-0000-4000-8000-000000000001", amount, expense_date: "2026-10-21", description: "Synthetic utilities", payment_method: "cash" })) result.set(key, value);
  return result;
};
beforeEach(() => { vi.resetAllMocks(); requireOwner.mockResolvedValue({ id: "owner" }); insert.mockResolvedValue({ error: null }); });
describe("expense monetary precision", () => {
  it.each(["0.01", "123.01", "999999999999.99"])("preserves a valid amount %s", async amount => {
    expect(await createExpenseAction(form(amount))).toMatchObject({ ok: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ amount: Number(amount) }));
  });
  it.each(["1.005", "0", "-1", "NaN", "Infinity", "1000000000000"])("rejects %s without silently rounding or writing", async amount => {
    expect(await createExpenseAction(form(amount))).toMatchObject({ ok: false });
    expect(insert).not.toHaveBeenCalled();
  });
});
