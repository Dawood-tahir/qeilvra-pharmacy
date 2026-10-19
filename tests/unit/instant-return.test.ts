import { beforeEach, describe, expect, it, vi } from "vitest";
const { requireStaff, rpc, revalidatePath } = vi.hoisted(() => ({ requireStaff: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireStaff, requireOwner: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath }));
import { completeReturnAction } from "@/app/(app)/returns/actions";
const input = { saleId: "70000000-0000-4000-8000-000000000007", idempotencyKey: "a0000000-0000-4000-8000-000000000001", reason: "Unopened medicine", paymentMethod: "cash", cardConfirmed: false, items: [{ sale_item_id: "60000000-0000-4000-8000-000000000006", quantity: 2, restockable: true }] };
beforeEach(() => { vi.resetAllMocks(); requireStaff.mockResolvedValue({ role: "salesperson" }); rpc.mockResolvedValue({ data: { id: input.idempotencyKey, return_number: "RET-TEST", refund: 120 }, error: null }); });
describe("immediate return action", () => {
  it.each(["owner", "salesperson"])("%s uses one atomic RPC with a stable key and no approval calls", async (role) => {
    requireStaff.mockResolvedValue({ role });
    expect(await completeReturnAction(input)).toMatchObject({ ok: true, refund: 120 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("complete_sale_return", { p_sale_id: input.saleId, p_items: input.items, p_reason: input.reason, p_key: input.idempotencyKey, p_payment_method: "cash", p_card_confirmed: false });
    expect(revalidatePath).toHaveBeenCalledWith("/suppliers/[id]", "page");
  });
  it.each([{ ...input, paymentMethod: "card" }, { ...input, items: [...input.items, ...input.items] }, { ...input, items: [{ ...input.items[0], quantity: 0.5 }] }, { ...input, reason: "" }])("rejects invalid requests before mutation", async (value) => { expect(await completeReturnAction(value)).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled(); });
  it("checks authentication before the database", async () => { requireStaff.mockRejectedValue(new Error("Sign in")); await expect(completeReturnAction(input)).rejects.toThrow("Sign in"); expect(rpc).not.toHaveBeenCalled(); });
  it("keeps unknown outcomes retryable and distinguishes database rejections", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "", message: "offline" } });
    expect(await completeReturnAction(input)).toMatchObject({ ok: false, uncertain: true });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "session changed" } });
    expect(await completeReturnAction(input)).toMatchObject({ ok: false, uncertain: true });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Return quantity exceeds the eligible quantity." } });
    expect(await completeReturnAction(input)).toMatchObject({ ok: false, uncertain: false });
  });
});
