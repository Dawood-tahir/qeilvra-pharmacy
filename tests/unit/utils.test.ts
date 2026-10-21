import { describe, expect, it } from "vitest";
import { formatCurrency, getInitials, localDateISO } from "@/lib/utils";

describe("Qeilvra formatting contracts", () => {
  it("formats monetary values as Pakistani rupees", () => {
    expect(formatCurrency(12450)).toContain("12,450");
    expect(formatCurrency(0)).toContain("0");
    for (const missing of [null, undefined, "", "bad", NaN, Infinity]) expect(formatCurrency(missing)).toBe("Unavailable");
    expect(formatCurrency(-7889702.83)).toContain("7,889,702.83");
    expect(formatCurrency(-7889702.83)).toContain("-");
  });

  it("uses a stable Asia/Karachi calendar date", () => {
    expect(localDateISO(new Date("2026-10-14T20:30:00.000Z"))).toBe("2026-10-15");
  });

  it("creates accessible avatar initials", () => {
    expect(getInitials("Ayesha Khan")).toBe("AK");
    expect(getInitials("Qeilvra")).toBe("Q");
  });
});
