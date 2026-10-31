import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireOperationsManager: mocks.authorize }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { saveGuidedMedicineAction } from "@/app/(app)/medicines/actions";
const id = "40000000-0000-4000-8000-000000000004", key = "60000000-0000-4000-8000-000000000006";
const stock = { unit_key: "box", quantity: 2, batch_number: "CAD22", expiry_date: "2099-12-25", total_cost: "1000", supplier_id: "" };
const data = { name: "CAD 22", dosage_form: "Tablet", strength: "22mg", barcode: "", manufacturer: "", tablets_per_strip: 12, strips_per_box: 11, units: [
  { unit_key: "base", selling_price: "forged", max_price: null }, { unit_key: "strip", selling_price: "0", max_price: null }, { unit_key: "box", selling_price: "1320", max_price: null },
] };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockResolvedValue({ role: "owner" });
  mocks.rpc.mockResolvedValue({ data: { id, quantity: 264 }, error: null });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
  mocks.maybeSingle.mockResolvedValue({ data: { dosage_form: "Tablet", tablets_per_strip: 12, strips_per_box: 11, medicine_units: [
    { unit_key: "base", selling_price: 12, max_price: null }, { unit_key: "strip", selling_price: 130, max_price: null }, { unit_key: "box", selling_price: 1320, max_price: null },
  ] }, error: null });
});
describe("server-authoritative box pricing", () => {
  it.each(["owner", "manager"])("recalculates create values for authorized %s and retains original stock/cost payload", async role => {
    mocks.authorize.mockResolvedValue({ role });
    expect(await saveGuidedMedicineAction(null, data, stock, key)).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("save_guided_medicine", expect.objectContaining({ p_id: null, p_stock: stock, p_key: key, p_data: expect.objectContaining({ units: [
      { unit_key: "base", selling_price: "10.00", max_price: null }, { unit_key: "strip", selling_price: "120.00", max_price: null }, { unit_key: "box", selling_price: "1320", max_price: null },
    ] }) }));
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("cannot bypass new-medicine derivation with a forged preserve flag", async () => {
    expect(await saveGuidedMedicineAction(null, { ...data, pricing_mode: "preserve" }, stock, key)).toMatchObject({ ok: true });
    expect(mocks.rpc.mock.calls[0][1].p_data.units[0].selling_price).toBe("10.00");
  });
  it("preserves current database prices on a details-only legacy edit, ignoring submitted prices", async () => {
    expect(await saveGuidedMedicineAction(id, { ...data, pricing_mode: "preserve" }, null, key)).toMatchObject({ ok: true });
    expect(mocks.from).toHaveBeenCalledWith("medicines");
    expect(mocks.eq).toHaveBeenCalledWith("id", id);
    expect(mocks.rpc.mock.calls[0][1].p_data.units.map((unit: { selling_price: string }) => unit.selling_price)).toEqual(["12", "130", "1320"]);
    expect(mocks.revalidate).toHaveBeenCalledWith(`/medicines/${id}`);
    expect(mocks.revalidate).toHaveBeenCalledWith("/pos");
  });
  it("recalculates intentionally edited pricing or changed packaging", async () => {
    await saveGuidedMedicineAction(id, { ...data, pricing_mode: "box" }, null, key);
    expect(mocks.rpc.mock.calls[0][1].p_data.units[0].selling_price).toBe("10.00");
    await saveGuidedMedicineAction(id, { ...data, strips_per_box: 10, pricing_mode: "preserve" }, null, key);
    expect(mocks.rpc.mock.calls[1][1].p_data.units[0].selling_price).toBe("11.00");
  });
  it("validates every permitted limit against the derived price", async () => {
    expect(await saveGuidedMedicineAction(null, { ...data, units: data.units.map(unit => ({ ...unit, max_price: unit.unit_key === "strip" ? "119" : null })) }, stock, key)).toMatchObject({ ok: false, error: expect.stringContaining("permitted limit") });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects invalid box inputs before sending any database mutation", async () => {
    expect(await saveGuidedMedicineAction(null, { ...data, units: data.units.map(unit => ({ ...unit, selling_price: "-1" })) }, stock, key)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails closed if saved prices cannot be verified", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: "private database error" } });
    expect(await saveGuidedMedicineAction(id, { ...data, pricing_mode: "preserve" }, null, key)).toMatchObject({ ok: false, error: expect.stringContaining("could not be loaded") });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires existing edit permission before reading or changing prices", async () => {
    mocks.authorize.mockRejectedValue(new Error("Forbidden"));
    await expect(saveGuidedMedicineAction(id, data, null, key)).rejects.toThrow("Forbidden");
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
