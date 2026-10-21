import { describe, expect, it } from "vitest";
import { assertFinancialAmounts, financeRange } from "@/lib/financial-analytics";
import { financialFixture } from "../ui/financial-data";

describe("Karachi financial periods", () => {
  const now = new Date("2026-10-18T20:00:00Z"); // Monday, 1 AM in Karachi.
  it("uses the Karachi date rather than UTC or browser timezone", () => expect(financeRange("today", undefined, undefined, now)).toEqual({ period: "today", from: "2026-10-19", to: "2026-10-19", granularity: "hour" }));
  it("starts weeks on Monday, including Sunday and year boundaries", () => {
    expect(financeRange("week", undefined, undefined, now).from).toBe("2026-10-19");
    expect(financeRange("week", undefined, undefined, new Date("2026-10-18T10:00Z")).from).toBe("2026-10-12");
    expect(financeRange("week", undefined, undefined, new Date("2027-01-01T10:00Z")).from).toBe("2026-12-28");
  });
  it("starts months on the first and ends today", () => expect(financeRange("month", undefined, undefined, now)).toMatchObject({ from: "2026-10-01", to: "2026-10-19", granularity: "day" }));
  it("preserves valid custom ranges", () => expect(financeRange("custom", "2026-01-01", "2026-01-31", now)).toMatchObject({ from: "2026-01-01", to: "2026-01-31" }));
  it.each([["2026-02-30", "2026-03-01"], ["2026-10-19", "2026-10-18"], ["2026-10-01", "2026-10-20"], ["2020-01-01", "2026-10-19"]])("rejects invalid custom dates %s to %s", (from, to) => expect(() => financeRange("custom", from, to, now)).toThrow());
});

describe("financial response accuracy boundary", () => {
  it("keeps legitimate negative profit, large costs and decimal expenses", () => {
    const snapshot = financialFixture();
    Object.assign(snapshot.metrics, { gross_profit: -7889702.83, expenses: 123.01, cogs: 7925001.83 });
    expect(() => assertFinancialAmounts(snapshot)).not.toThrow();
  });
  it.each([undefined, null, NaN, Infinity, 2 ** 45, 0.001, "12.34"])("rejects missing, malformed or unsafe money %s", value => {
    const snapshot = financialFixture();
    Object.assign(snapshot.metrics, { cogs: value });
    expect(() => assertFinancialAmounts(snapshot)).toThrow("accurately");
  });
});
