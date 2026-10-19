import { describe, expect, it } from "vitest";
import { profilePage, searchPattern, summarizeSupplier, supplierAlerts, type PurchaseSummary, type InventoryMedicine } from "@/lib/supplier-profile";

const receipt = (id: string, date: string, total: number, status = "posted", supplier: string | null = "supplier", medicines = ["medicine"]): PurchaseSummary => ({ id, supplier_id: supplier, invoice_date: date, total, status, purchase_items: medicines.map((medicine_id) => ({ medicine_id })) });
const medicine: InventoryMedicine = { id: "medicine", name: "Paracetamol", strength: "500mg", base_unit: "tablet", reorder_level: 10, is_active: true };
const batch = (quantity: number, expiry = "2026-11-01", quarantine = false, id = "medicine") => ({ medicine_id: id, quantity_on_hand: quantity, expiry_date: expiry, is_quarantined: quarantine });

describe("supplier purchase summaries", () => {
  it("handles suppliers with no transactions", () => {
    expect(summarizeSupplier("supplier", [])).toEqual({ total: 0, deliveries: 0, medicineCount: 0, drafts: 0, lastPurchase: null, lastPurchases: {} });
  });
  it("counts posted invoices once, distinct medicines and dates without guessing suppliers", () => {
    const first = receipt("initial", "2026-09-01", 200.10);
    const result = summarizeSupplier("supplier", [first, receipt("restock", "2026-10-10", 150.20), receipt("purchase", "2026-10-01", 250, "posted", "supplier", ["medicine", "second"]), receipt("draft", "2026-10-18", 999, "draft", "supplier", ["draft-only"]), receipt("cancelled", "2026-10-19", 999, "cancelled"), receipt("unassigned", "2026-10-20", 999, "posted", null), receipt("other", "2026-10-20", 999, "posted", "other"), first]);
    expect(result).toEqual({ total: 600.30, deliveries: 3, medicineCount: 2, drafts: 1, lastPurchase: "2026-10-10", lastPurchases: { medicine: "2026-10-10", second: "2026-10-01" } });
  });
});

describe("supplier inventory alerts match the existing inventory eligibility", () => {
  it("uses all available batches regardless of their supplier; excludes expired and quarantined stock", () => {
    const result = supplierAlerts([medicine], [batch(3), batch(4), batch(100, "2026-10-18"), batch(100, "2026-11-01", true)], { medicine: "2026-09-01" }, 60, "2026-10-19");
    expect(result[0]).toMatchObject({ available: 7, statuses: ["Low Stock", "Expiring Soon"], lastPurchase: "2026-09-01" });
    expect(supplierAlerts([medicine], [batch(3), batch(40, "2027-01-01")], { medicine: "2026-09-01" }, 1, "2026-10-19")).toEqual([]);
  });
  it("shows out of stock after every eligible unit has been sold, expired or quarantined", () => {
    expect(supplierAlerts([medicine], [batch(100, "2026-10-18"), batch(10, "2026-11-01", true), batch(0)], { medicine: "2026-09-01" }, 60, "2026-10-19")[0]).toMatchObject({ available: 0, statuses: ["Out of Stock"], nearestExpiry: null });
  });
  it("uses inclusive expiry and reorder thresholds", () => {
    expect(supplierAlerts([medicine], [batch(10, "2026-10-19")], { medicine: "2026-09-01" }, 60, "2026-10-19")[0].statuses).toEqual(["Low Stock", "Expiring Soon"]);
    expect(supplierAlerts([medicine], [batch(100, "2026-12-18")], { medicine: "2026-09-01" }, 60, "2026-10-19")[0].statuses).toEqual(["Expiring Soon"]);
    expect(supplierAlerts([medicine], [batch(100, "2026-12-19")], { medicine: "2026-09-01" }, 60, "2026-10-19")).toEqual([]);
  });
  it("requires verified posted history, skips inactive medicines and prioritizes out of stock", () => {
    const meds = [medicine, { ...medicine, id: "out" }, { ...medicine, id: "unverified" }, { ...medicine, id: "archived", is_active: false }];
    const items = supplierAlerts(meds, [batch(5)], { medicine: "2026-09-01", out: "2026-10-01", archived: "2026-10-01" }, 60, "2026-10-19");
    expect(items.map((item) => item.id)).toEqual(["out", "medicine"]);
  });
  it("sanitizes filter operators and handles invalid pagination", () => {
    expect(searchPattern("drug%,id.eq.other(test)")).toBe("%drug%id%eq%other%test%");
    for (const page of [undefined, "-1", "0", "NaN", "1.5", "Infinity"]) expect(profilePage(page)).toBe(1);
    expect(profilePage("2")).toBe(2);
  });
});
