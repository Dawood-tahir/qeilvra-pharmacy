import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireOwner, createClient, select, eq, order, renderForm } = vi.hoisted(() => ({
  requireOwner: vi.fn(), createClient: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), renderForm: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireOwner }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/components/medicines/medicine-form", () => ({ MedicineForm: (props: unknown) => { renderForm(props); return null; } }));
import NewMedicinePage from "@/app/(app)/medicines/new/page";

beforeEach(() => {
  vi.resetAllMocks();
  requireOwner.mockResolvedValue({ role: "owner" });
  select.mockReturnValue({ eq }); eq.mockReturnValue({ order });
  createClient.mockResolvedValue({ from: (table: string) => { expect(table).toBe("suppliers"); return { select }; } });
});
afterEach(cleanup);

describe("saved suppliers on Add New Medicine", () => {
  it("loads only active saved supplier IDs and names for the existing form", async () => {
    const suppliers = [{ id: "50000000-0000-4000-8000-000000000005", name: "Saved Medical Supplies" }];
    order.mockResolvedValue({ data: suppliers, error: null });
    render(await NewMedicinePage());
    expect(select).toHaveBeenCalledWith("id,name");
    expect(eq).toHaveBeenCalledWith("is_active", true);
    expect(order).toHaveBeenCalledWith("name");
    expect(renderForm).toHaveBeenCalledWith({ suppliers });
  });
  it("passes an empty list when no suppliers are saved", async () => {
    order.mockResolvedValue({ data: [], error: null });
    render(await NewMedicinePage());
    expect(renderForm).toHaveBeenCalledWith({ suppliers: [] });
  });
  it("reports failed supplier loading rather than pretending no suppliers exist", async () => {
    order.mockResolvedValue({ data: null, error: { message: "Database unavailable" } });
    await expect(NewMedicinePage()).rejects.toThrow("Saved suppliers could not be loaded");
    expect(renderForm).not.toHaveBeenCalled();
  });
  it("checks Owner permission before reading saved suppliers", async () => {
    requireOwner.mockRejectedValue(new Error("Owner required"));
    await expect(NewMedicinePage()).rejects.toThrow("Owner required");
    expect(createClient).not.toHaveBeenCalled();
  });
});
