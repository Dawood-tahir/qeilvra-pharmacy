import { toMinor } from "@/lib/medicine-units";

/** Prices are in rupees; arithmetic stays in integer paisa. */
export function validSalePrice(value: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(value) && toMinor(value) > 0 && toMinor(value) <= 99_999_999_999;
}

/** Match the existing return RPC's cumulative rounding, including invoice discounts. */
export function refundMinor(lineTotal: number, sold: number, alreadyApproved: number, returning: number): number {
  if (sold <= 0) return 0;
  const total = toMinor(lineTotal);
  return Math.round(total * (alreadyApproved + returning) / sold) - Math.round(total * alreadyApproved / sold);
}
