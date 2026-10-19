import { beforeEach, describe, expect, it, vi } from "vitest";
const { requireOwner, rpc, revalidatePath } = vi.hoisted(() => ({ requireOwner: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireOwner }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath }));
import { disposeStockAction, confirmSupplierRecoveryAction } from "@/app/(app)/stock/actions";
import { batchCostMinor } from "@/lib/stock-disposition";
const input = { key: "ab000000-0000-4000-8000-000000000001", batchId: "ab000000-0000-4000-8000-000000000002", kind: "discard", quantity: 7, expectedQuantity: 100, reason: "Expired stock", supplierId: null, method: "credit", removed: true };
beforeEach(() => { vi.resetAllMocks(); requireOwner.mockResolvedValue({ id: "owner" }); rpc.mockResolvedValue({ data: { id: input.key, quantity: 93, value: 14 }, error: null }); });
describe("audited stock actions", () => {
  it("requires Owner authorization before any mutation", async () => { requireOwner.mockRejectedValue(new Error("Owner required")); await expect(disposeStockAction(input)).rejects.toThrow("Owner required"); expect(rpc).not.toHaveBeenCalled(); });
  it("uses the atomic idempotent stock operation and refreshes affected reports", async () => { expect(await disposeStockAction(input)).toMatchObject({ ok: true, quantity: 93 }); expect(rpc).toHaveBeenCalledExactlyOnceWith("dispose_stock", { p_key: input.key, p_batch_id: input.batchId, p_kind: "discard", p_quantity: 7, p_expected_quantity: 100, p_reason: "Expired stock", p_supplier_id: null, p_method: "credit" }); expect(revalidatePath).toHaveBeenCalledWith("/reports"); expect(revalidatePath).toHaveBeenCalledWith("/suppliers/[id]", "page"); });
  it.each([{ ...input, quantity: -1 }, { ...input, quantity: 0.5 }, { ...input, removed: false }, { ...input, reason: "" }])("rejects invalid or unconfirmed disposal before the database", async value => { expect(await disposeStockAction(value)).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled(); });
  it("preserves uncertain outcomes for safe retry", async () => { rpc.mockResolvedValue({ error: { code: "", message: "network" } }); expect(await disposeStockAction(input)).toMatchObject({ ok: false, uncertain: true }); rpc.mockResolvedValue({ error: { code: "P0001", message: "Stock changed." } }); expect(await disposeStockAction(input)).toMatchObject({ ok: false, uncertain: false, error: "Stock changed." }); });
  it("validates actual supplier recovery and real replacement details", async () => { const recovery = { key: input.key, dispositionId: input.batchId, method: "credit", amount: 12, reference: "Credit 123", confirmed: true, replacement: null }; expect(await confirmSupplierRecoveryAction(recovery)).toMatchObject({ ok: true }); expect(rpc).toHaveBeenCalledWith("confirm_supplier_recovery", expect.objectContaining({ p_amount: 12, p_method: "credit" })); rpc.mockClear(); expect(await confirmSupplierRecoveryAction({ ...recovery, method: "replacement" })).toMatchObject({ ok: false }); expect(rpc).not.toHaveBeenCalled(); });
  it("calculates cost previews in paisa from four-decimal batch cost", () => { expect(batchCostMinor(2, 7)).toBe(1400); expect(batchCostMinor(0.1255, 1)).toBe(13); expect(batchCostMinor(0.1255, 2)).toBe(25); });
});
