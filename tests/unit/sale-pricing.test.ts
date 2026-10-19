import { describe, expect, it } from "vitest";
import { refundMinor, validSalePrice } from "@/lib/sale-pricing";

describe("sale-only prices and refund estimates", () => {
  it.each(["0.01", "1.50", "650", "999999999.99"])("accepts price %s", (price) => expect(validSalePrice(price)).toBe(true));
  it("allocates the final paisa exactly across partial refunds", () => {
    expect(refundMinor(10, 3, 0, 1)).toBe(333);
    expect(refundMinor(10, 3, 1, 1)).toBe(334);
    expect(refundMinor(10, 3, 2, 1)).toBe(333);
    expect(refundMinor(10, 3, 0, 3)).toBe(1000);
  });
  it("uses the discounted original line amount", () => expect(refundMinor(180, 3, 0, 2)).toBe(12000));
});
