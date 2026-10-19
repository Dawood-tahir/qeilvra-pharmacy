import { toMinor } from "@/lib/medicine-units";

export type DiscountMode = "fixed" | "percent";
export const validAmount = (value: string) => /^\d+(\.\d{0,2})?$/.test(value) && Number(value) <= 999999999.99;

export function discountAmount(grossMinor: number, value: string, mode: DiscountMode): number {
  if (!validAmount(value)) return 0;
  const reduction = mode === "percent"
    ? Number((BigInt(grossMinor) * BigInt(toMinor(Math.min(Number(value), 100))) + 5000n) / 10000n)
    : toMinor(value);
  return Math.min(grossMinor, reduction);
}

/** Item reductions are applied once, then the invoice reduction uses the remaining medicine value. */
export function posTotals(items: { quantity: number; unit: { selling_price: number }; itemDiscount?: string; discountMode?: DiscountMode }[], discount: string, mode: DiscountMode, extra: string) {
  const lines = items.map(item => {
    const gross = toMinor(item.unit.selling_price) * item.quantity;
    return { gross, discount: discountAmount(gross, item.itemDiscount ?? "0", item.discountMode ?? "fixed") };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.gross, 0);
  const itemDiscount = lines.reduce((sum, line) => sum + line.discount, 0);
  const invoiceDiscount = discountAmount(subtotal - itemDiscount, discount, mode);
  const extraAmount = validAmount(extra) ? toMinor(extra) : 0;
  return { subtotal, itemDiscount, invoiceDiscount, discount: itemDiscount + invoiceDiscount, extraAmount, total: subtotal - itemDiscount - invoiceDiscount + extraAmount, lines };
}
