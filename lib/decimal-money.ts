/** Multiply a recorded decimal cost by whole base units, then round to paisa.
 * PostgreSQL NUMERIC rounds a positive half away from zero. Never round the
 * unit cost first: receiving may retain many more than four decimal places.
 */
export function decimalCostMinor(cost: number | string, quantity: number): number | null {
  if (!Number.isSafeInteger(quantity) || quantity < 0) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(cost));
  if (!match) return null;
  const scale = (match[2]?.length ?? 0) - Number(match[3] ?? 0);
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 1000) return null;
  const digits = BigInt(match[1] + (match[2] ?? ""));
  const numerator = digits * BigInt(quantity) * 100n * (scale < 0 ? 10n ** BigInt(-scale) : 1n);
  const denominator = scale > 0 ? 10n ** BigInt(scale) : 1n;
  const rounded = (2n * numerator + denominator) / (2n * denominator);
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : null;
}
