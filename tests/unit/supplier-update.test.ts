import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ staff: vi.fn(), requireManager: vi.fn(), createClient: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentStaff: mocks.staff, requireOperationsManager: mocks.requireManager }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { setSupplierActiveAction, updateSupplierAction } from "@/app/(app)/suppliers/actions";

const id = "50000000-0000-4000-8000-000000000005";
const values = { name: "City Pharmacy", contact_person: "Ahmed", phone: "+923001234567", email: "orders@example.com", address: "12 Main Road\nFloor 2", city: "Lahore", tax_number: "NTN-001 / A" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.staff.mockResolvedValue({ id: "owner", role: "owner" });
  mocks.maybeSingle.mockResolvedValue({ data: { id }, error: null });
  mocks.select.mockReturnValue({ maybeSingle: mocks.maybeSingle });
  mocks.eq.mockReturnValue({ select: mocks.select });
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.createClient.mockResolvedValue({ from: (table: string) => { expect(table).toBe("suppliers"); return { update: mocks.update }; } });
});

describe("independent supplier activation", () => {
  it.each(["false", "true"])("changes only activation when active is %s", async active => {
    mocks.eq.mockResolvedValueOnce({ error: null });
    const form = new FormData();
    form.set("id", id);
    form.set("active", active);
    form.set("name", "Do not overwrite supplier details");
    expect(await setSupplierActiveAction(form)).toMatchObject({ ok: true });
    expect(mocks.requireManager).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ is_active: active === "true" });
    expect(mocks.eq).toHaveBeenCalledWith("id", id);
    expect(mocks.revalidate).toHaveBeenCalledWith(`/suppliers/${id}`);
    expect(mocks.revalidate).toHaveBeenCalledWith("/suppliers");
  });
  it("requires server authorization before changing status", async () => {
    mocks.requireManager.mockRejectedValue(new Error("Forbidden"));
    const form = new FormData();
    form.set("id", id);
    form.set("active", "false");
    await expect(setSupplierActiveAction(form)).rejects.toThrow("Forbidden");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
describe("supplier information update action", () => {
  it.each(["owner", "manager"])("allows an authorized %s to update only seven columns on the existing ID", async role => {
    mocks.staff.mockResolvedValue({ id: "staff", role });
    expect(await updateSupplierAction(id, { ...values, id: "different", is_active: false, created_by: "forged", role: "owner", tenant_id: "forged" })).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith(values);
    expect(mocks.eq).toHaveBeenCalledWith("id", id);
    expect(mocks.select).toHaveBeenCalledWith("id");
    expect(mocks.revalidate).toHaveBeenCalledWith(`/suppliers/${id}`);
    expect(mocks.revalidate).toHaveBeenCalledWith("/suppliers");
    expect(mocks.revalidate).toHaveBeenCalledWith("/stock");
    expect(mocks.revalidate).toHaveBeenCalledWith("/purchases");
    expect(mocks.revalidate).toHaveBeenCalledWith("/purchases/[id]", "page");
  });
  it.each([null, { role: "salesperson" }])("rejects unauthorized or expired sessions before accessing supplier data", async staff => {
    mocks.staff.mockResolvedValue(staff);
    expect(await updateSupplierAction(id, values)).toMatchObject({ ok: false, error: expect.any(String) });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("rejects malformed IDs and field validation errors without writing", async () => {
    expect(await updateSupplierAction("wrong", values)).toMatchObject({ ok: false });
    expect(await updateSupplierAction(id, { ...values, name: " ", email: "test@gmail", phone: "call me" })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String), email: expect.any(String), phone: expect.any(String) } });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not report success for missing or RLS-invisible rows", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await updateSupplierAction(id, values)).toMatchObject({ ok: false, error: expect.stringMatching(/not found|permission/) });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("keeps database failures actionable without leaking database internals", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: "42501", message: "private database details" } });
    expect(await updateSupplierAction(id, values)).toEqual({ ok: false, error: "You do not have permission to edit this supplier." });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: "08006", message: "private connection details" } });
    expect(await updateSupplierAction(id, values)).toMatchObject({ ok: false, error: expect.stringContaining("entries are kept") });
  });
});
