import { describe, expect, it } from "vitest";
import { discountAmount, posTotals, validAmount } from "@/lib/pos-totals";

describe("POS invoice arithmetic", () => {
  const item = { quantity: 5, unit: { selling_price: 100 } };
  it("calculates the requested subtotal minus discount plus extra charge", () => {
    expect(posTotals([item], "50", "fixed", "30")).toMatchObject({ subtotal: 50000, discount: 5000, extraAmount: 3000, total: 48000 });
  });
  it("applies bill percentage after item reductions without counting either twice", () => {
    expect(posTotals([{ ...item, itemDiscount: "10", discountMode: "percent" }], "10", "percent", "30")).toMatchObject({ itemDiscount: 5000, invoiceDiscount: 4500, discount: 9500, total: 43500 });
  });
  it("removes charges and discounts immediately", () => {
    expect(posTotals([item], "0", "fixed", "0")).toMatchObject({ discount: 0, extraAmount: 0, total: 50000 });
  });
  it("rounds in paisa and caps the preview at the eligible medicine amount", () => {
    expect(discountAmount(333, "5", "percent")).toBe(17);
    expect(discountAmount(333, "500", "fixed")).toBe(333);
  });
  it.each(["-1", "NaN", "Infinity", "1e2", "1.001", "1000000000", ""]) ("rejects invalid amount %s", value => expect(validAmount(value)).toBe(false));
});
