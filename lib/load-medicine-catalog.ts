import type { StockMedicine } from "@/lib/medicine-units";

export const CATALOG_PAGE_SIZE = 50;

export async function loadMedicineCatalog(fetchPage: (offset: number, limit: number) => PromiseLike<StockMedicine[]>) {
  const catalog: StockMedicine[] = [];
  for (let offset = 0; ; offset += CATALOG_PAGE_SIZE) {
    const page = await fetchPage(offset, CATALOG_PAGE_SIZE);
    catalog.push(...page);
    if (page.length < CATALOG_PAGE_SIZE) return catalog;
  }
}

export function medicineSearchFields(medicine: Pick<StockMedicine, "name" | "generic_name" | "strength" | "sku" | "barcode">) {
  return [medicine.name, medicine.generic_name, [medicine.name, medicine.strength].filter(Boolean).join(" "), medicine.sku, medicine.barcode];
}

export function rankMedicineMatches(matches: readonly StockMedicine[], term: string) {
  if (!term) return matches;
  const rank = (item: StockMedicine) => item.barcode?.toLowerCase() === term ? 0 : item.sku?.toLowerCase() === term ? 1 : 2;
  return [...matches].sort((a, b) => rank(a) - rank(b));
}
