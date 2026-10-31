export type BoxSellingPrices = { box: string; strip: string; base: string };

/** Match the existing money/pack-size limits and PostgreSQL NUMERIC half-up rounding. */
export function calculateBoxSellingPrices(price: string, tabletsPerStrip: number, stripsPerBox: number): BoxSellingPrices | null {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(price);
  if (!match || !Number.isSafeInteger(tabletsPerStrip) || tabletsPerStrip <= 0 || !Number.isSafeInteger(stripsPerBox) || stripsPerBox <= 0) return null;
  const total = tabletsPerStrip * stripsPerBox;
  if (!Number.isSafeInteger(total) || total > 999_999_999) return null;
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (minor <= 0n) return null;
  const divide = (quantity: number) => {
    const divisor = BigInt(quantity);
    const rounded = (2n * minor + divisor) / (2n * divisor);
    return `${rounded / 100n}.${String(rounded % 100n).padStart(2, "0")}`;
  };
  // Never reconstruct box price by multiplying rounded smaller-unit prices.
  return { box: price, strip: divide(stripsPerBox), base: divide(total) };
}

export function hasBoxPackaging(input: unknown): input is Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return (value.dosage_form === "Tablet" || value.dosage_form === "Capsule") && value.strips_per_box != null;
}

/** Run before server validation so forged calculated prices are never authoritative. */
export function deriveBoxPricingInput(input: Record<string, unknown>): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (!Array.isArray(input.units) || input.units.length !== 3 || input.units.some(unit => !unit || typeof unit !== "object")) return { ok: false, error: "Check the box, strip and single-unit selling prices." };
  const units = input.units as Record<string, unknown>[];
  const keys = new Set(units.map(unit => unit.unit_key));
  if (keys.size !== 3 || !["base", "strip", "box"].every(key => keys.has(key))) return { ok: false, error: "Check the selling units for this packaging." };
  const boxPrice = units.find(unit => unit.unit_key === "box")?.selling_price;
  const prices = typeof boxPrice === "string" ? calculateBoxSellingPrices(boxPrice, input.tablets_per_strip as number, input.strips_per_box as number) : null;
  if (!prices) return { ok: false, error: "Enter a box selling price greater than zero with up to two decimal places and confirm whole, positive packaging quantities." };
  if (prices.base === "0.00" || prices.strip === "0.00") return { ok: false, error: "The box selling price must give each selling unit a price of at least Rs. 0.01." };
  return { ok: true, data: { ...input, pricing_mode: "box", units: units.map(unit => ({ ...unit, selling_price: prices[unit.unit_key as keyof BoxSellingPrices] })) } };
}
