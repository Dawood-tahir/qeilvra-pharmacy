import { describe, expect, it } from "vitest";
import { calculateBoxSellingPrices, deriveBoxPricingInput } from "@/lib/box-pricing";

describe("box-authoritative selling prices", () => {
  it("calculates the CAD 22 example from the actual packaging", () => {
    expect(calculateBoxSellingPrices("1320", 12, 11)).toEqual({ box: "1320", strip: "120.00", base: "10.00" });
    expect(calculateBoxSellingPrices("2640", 12, 11)).toEqual({ box: "2640", strip: "240.00", base: "20.00" });
    expect(calculateBoxSellingPrices("1320", 6, 5)).toEqual({ box: "1320", strip: "264.00", base: "44.00" });
  });
  it("rounds half-up in integer paisa without rebuilding the entered box price", () => {
    expect(calculateBoxSellingPrices("1.01", 1, 2)).toEqual({ box: "1.01", strip: "0.51", base: "0.51" });
    expect(calculateBoxSellingPrices("100", 12, 11)).toEqual({ box: "100", strip: "9.09", base: "0.76" });
    expect(calculateBoxSellingPrices("0.30", 1, 3)).toEqual({ box: "0.30", strip: "0.10", base: "0.10" });
    expect(calculateBoxSellingPrices("9999999999.99", 1, 2)?.base).toBe("5000000000.00");
  });
  it.each(["", "-1", "0", "0.00", "NaN", "Infinity", "1e3", "1.001", "10000000000", "abc"])("clears calculated prices for invalid box input %j", value => {
    expect(calculateBoxSellingPrices(value, 12, 11)).toBeNull();
  });
  it.each([[0, 11], [12, 0], [1.5, 11], [NaN, 11], [12, Infinity], [999999999, 2]])("never divides by invalid packaging %j", (strip, box) => {
    expect(calculateBoxSellingPrices("1320", strip, box)).toBeNull();
  });
  it("ignores forged calculated prices and retains per-unit limits", () => {
    const result = deriveBoxPricingInput({ tablets_per_strip: 12, strips_per_box: 11, units: [
      { unit_key: "base", selling_price: "0", max_price: "11" },
      { unit_key: "strip", selling_price: "forged", max_price: "121" },
      { unit_key: "box", selling_price: "1320", max_price: "1400" },
    ] });
    expect(result).toMatchObject({ ok: true, data: { units: [
      { unit_key: "base", selling_price: "10.00", max_price: "11" },
      { unit_key: "strip", selling_price: "120.00", max_price: "121" },
      { unit_key: "box", selling_price: "1320", max_price: "1400" },
    ] } });
  });
  it("rejects a positive box price that rounds a smaller selling unit to zero", () => {
    expect(deriveBoxPricingInput({ tablets_per_strip: 12, strips_per_box: 11, units: ["base", "strip", "box"].map(unit_key => ({ unit_key, selling_price: "0.01", max_price: null })) })).toMatchObject({ ok: false, error: expect.stringContaining("at least Rs. 0.01") });
  });
});
