export type SellingUnit = { unit_key: string; label: string; base_quantity: number; selling_price: number; max_price?: number | null };
export type StockMedicine = {
  id: string; name: string; is_active?: boolean; generic_name?: string; manufacturer?: string; strength?: string;
  dosage_form?: string; barcode?: string; sku: string; selling_price: number; base_unit: string;
  available_quantity: number; nearest_expiry?: string; expiring_soon?: boolean; stock_status: string;
  packaging_status: "needs_review" | "confirmed"; units: SellingUnit[];
};

export const medicineTypes = ["Tablet", "Capsule", "Syrup", "Injection", "Cream", "Sachet", "Other"] as const;
export function baseUnitFor(type: string) {
  return ({ Tablet: "tablet", Capsule: "capsule", Syrup: "bottle", Injection: "injection", Cream: "tube", Sachet: "sachet" } as Record<string, string>)[type] ?? "unit";
}
export function pluralUnit(label: string, count: number) {
  return `${count} ${label}${count === 1 ? "" : label === "box" ? "es" : "s"}`;
}
export function toMinor(value: string | number): number {
  const match = String(value).match(/^(\d+)(?:\.(\d{0,2}))?$/);
  if (!match) return 0;
  const result = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : 0;
}
export function priceSuggestion(price: string, factor: number) {
  return ((toMinor(price) * factor) / 100).toFixed(2);
}
export function stockQuantity(count: number, factor: number) {
  const total = count * factor;
  return Number.isSafeInteger(count) && count > 0 && Number.isSafeInteger(factor) && factor > 0 && Number.isSafeInteger(total) && total <= 999_999_999 ? total : 0;
}
export function humanStock(total: number, base: string, units: SellingUnit[]) {
  if (!Number.isSafeInteger(total) || total < 0) return `${total} ${base} (review needed)`;
  let remaining = total;
  const parts: string[] = [];
  for (const unit of [...units].sort((a, b) => b.base_quantity - a.base_quantity)) {
    if (unit.base_quantity <= 1) continue;
    const count = Math.floor(remaining / unit.base_quantity);
    if (count) { parts.push(pluralUnit(unit.label, count)); remaining %= unit.base_quantity; }
  }
  if (remaining || !parts.length) parts.push(pluralUnit(base, remaining));
  return parts.join(" + ");
}
export function cartBaseQuantity(lines: { id: string; quantity: number; unit: SellingUnit }[], id: string) {
  return lines.filter((line) => line.id === id).reduce((sum, line) => sum + line.quantity * line.unit.base_quantity, 0);
}
