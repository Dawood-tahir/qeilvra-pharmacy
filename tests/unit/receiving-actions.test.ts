import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireOwner, rpc, insert, from, revalidatePath } = vi.hoisted(() => ({ requireOwner: vi.fn(), rpc: vi.fn(), insert: vi.fn(), from: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireOwner }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));
vi.mock("next/cache", () => ({ revalidatePath }));
import { receiveStockAction, saveGuidedMedicineAction } from "@/app/(app)/medicines/actions";
import { createPurchaseAction, postPurchaseAction } from "@/app/(app)/purchases/actions";
import { createExpenseAction } from "@/app/(app)/expenses/actions";

const id = "40000000-0000-4000-8000-000000000004";
const supplierId = "50000000-0000-4000-8000-000000000005";
const key = "60000000-0000-4000-8000-000000000006";
const stock = { unit_key: "box", quantity: 1, batch_number: "BATCH", expiry_date: "2099-12-25", total_cost: "200", supplier_id: supplierId };
const purchase = { supplier_id: supplierId, invoice_date: "2026-10-18", discount: 0, items: [{ medicine_id: id, batch_number: "BATCH", expiry_date: "2099-12-25", unit_key: "box", quantity: 1, unit_cost: 200 }] };
const expense = () => { const form = new FormData(); Object.entries({ category_id: id, amount: "500", expense_date: "2026-10-18", description: "Electricity bill", payment_method: "cash" }).forEach(([k, value]) => form.set(k, value)); return form; };
beforeEach(() => {
  vi.resetAllMocks();
  requireOwner.mockResolvedValue({ id: "owner", role: "owner" });
  rpc.mockResolvedValue({ data: { id, quantity: 100 }, error: null });
  insert.mockResolvedValue({ error: null });
  from.mockReturnValue({ insert });
});

describe("existing Owner receiving operations", () => {
  it("forwards the saved supplier ID and original receipt key without inserting a supplier", async () => {
    expect(await receiveStockAction(id, stock, key)).toMatchObject({ ok: true, quantity: 100 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("receive_stock", { p_id: id, p_stock: stock, p_key: key });
    expect(from).not.toHaveBeenCalled();
  });
  it("preserves the existing optional supplier behavior", async () => {
    expect(await receiveStockAction(id, { ...stock, supplier_id: "" }, key)).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("receive_stock", expect.objectContaining({ p_stock: { ...stock, supplier_id: "" } }));
  });
  it("rejects a typed supplier name instead of accepting it as an identity", async () => {
    expect(await receiveStockAction(id, { ...stock, supplier_id: "City Medical" }, key)).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("distinguishes lost responses from database validation failures", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "", message: "fetch failed" } });
    expect(await receiveStockAction(id, stock, key)).toMatchObject({ ok: false, uncertain: true });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Enter a batch number and a future expiry date." } });
    expect(await receiveStockAction(id, stock, key)).toMatchObject({ ok: false, uncertain: false });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("saves new medicine and initial stock through one existing atomic operation", async () => {
    const data = { name: "Paracetamol", dosage_form: "Tablet", strength: "500mg", barcode: "", manufacturer: "", tablets_per_strip: 10, strips_per_box: 10, units: [{ unit_key: "base", selling_price: "7", max_price: null }, { unit_key: "strip", selling_price: "65", max_price: null }, { unit_key: "box", selling_price: "620", max_price: null }] };
    expect(await saveGuidedMedicineAction(null, data, stock, key)).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("save_guided_medicine", expect.objectContaining({ p_id: null, p_stock: stock, p_key: key }));
  });
  it("draft creation keeps purchased units and does not call posting", async () => {
    rpc.mockResolvedValue({ data: id, error: null });
    expect(await createPurchaseAction(purchase)).toEqual({ ok: true, id });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_purchase", expect.objectContaining({ p_data: expect.objectContaining({ supplier_id: supplierId }), p_items: purchase.items }));
  });
  it("an ambiguous draft result requires checking Purchases instead of creating another draft", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "", message: "Network error" } });
    expect(await createPurchaseAction(purchase)).toMatchObject({ ok: false, uncertain: true });
  });
  it("expense errors retain an honest unknown outcome", async () => {
    insert.mockResolvedValue({ error: { code: "", message: "fetch failed" } });
    expect(await createExpenseAction(expense())).toMatchObject({ ok: false, uncertain: true });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it.each(["receive", "medicine", "draft", "post", "expense"])("%s refuses unauthorized callers before accessing the database", async (operation) => {
    requireOwner.mockRejectedValue(new Error("Owner required"));
    const form = new FormData(); form.set("id", id);
    const call = operation === "receive" ? () => receiveStockAction(id, stock, key) : operation === "medicine" ? () => saveGuidedMedicineAction(null, {}, stock, key) : operation === "draft" ? () => createPurchaseAction(purchase) : operation === "post" ? () => postPurchaseAction(form) : () => createExpenseAction(expense());
    await expect(call()).rejects.toThrow("Owner required");
    expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
  });
});
