import { toMinor } from "@/lib/medicine-units";

/** Prices are in rupees; arithmetic stays in integer paisa. */
export function validSalePrice(value: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(value) && toMinor(value) > 0 && toMinor(value) <= 99_999_999_999;
}

/** Match the existing return RPC's cumulative rounding, including invoice discounts. */
export function refundMinor(lineTotal: number, sold: number, alreadyApproved: number, returning: number): number {
  if (sold <= 0 || ![lineTotal, sold, alreadyApproved, returning].every((value) => Number.isFinite(value) && value >= 0)) return 0;
  // Legacy lines may have an unrounded invoice-discount allocation. Preserve it
  // until cumulative refund rounding, as PostgreSQL does, rather than dropping it.
  const fraction = (value: number) => {
    const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e");
    const [whole, decimal = ""] = mantissa.split(".");
    const scale = decimal.length - Number(exponent);
    return { n: BigInt(whole + decimal) * (scale < 0 ? 10n ** BigInt(-scale) : 1n), d: scale > 0 ? 10n ** BigInt(scale) : 1n };
  };
  const total = fraction(lineTotal), count = fraction(sold);
  const cumulative = (quantity: number) => {
    const units = fraction(quantity);
    const numerator = total.n * 100n * units.n * count.d;
    const denominator = total.d * units.d * count.n;
    return (2n * numerator + denominator) / (2n * denominator);
  };
  return Number(cumulative(alreadyApproved + returning) - cumulative(alreadyApproved));
}
