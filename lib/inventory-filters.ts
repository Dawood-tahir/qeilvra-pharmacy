import type { StockMedicine } from "@/lib/medicine-units";

export const inventoryFilters = [
  { value: "all", label: "All Medicines" },
  { value: "expired", label: "Expired" },
  { value: "not_expired", label: "Not Expired" },
  { value: "out_of_stock", label: "Out of Stock" },
] as const;

export const inventoryQuickFilters = [
  { value: "low_stock", label: "View Low Stock" },
  { value: "expiring", label: "View Expiring Medicines" },
  { value: "review", label: "Packaging to Review" },
] as const;

export type InventoryFilter = (typeof inventoryFilters | typeof inventoryQuickFilters)[number]["value"];
export type InventorySort = "name" | "stock" | "expiry";

export type InventoryBatchExpiry = {
  medicine_id: string;
  earliest_expired: string | null;
  nearest_unexpired: string | null;
};

export function parseInventoryFilter(value?: string | null): InventoryFilter {
  return [...inventoryFilters, ...inventoryQuickFilters].find((entry) => entry.value === value)?.value ?? "all";
}

export function parseInventorySort(value?: string | null): InventorySort {
  return value === "stock" || value === "expiry" ? value : "name";
}

export function isBatchExpiryFilter(filter: InventoryFilter) {
  return filter === "expired" || filter === "not_expired";
}

export function inventoryExpiryDate(item: StockMedicine, filter: InventoryFilter, batch?: InventoryBatchExpiry) {
  if (filter === "expired") return batch?.earliest_expired;
  if (filter === "not_expired") return batch?.nearest_unexpired;
  return item.nearest_expiry;
}

export function matchesInventoryFilter(item: StockMedicine, filter: InventoryFilter, batch?: InventoryBatchExpiry) {
  if (isBatchExpiryFilter(filter)) return Boolean(inventoryExpiryDate(item, filter, batch));
  if (filter === "out_of_stock") return Number(item.available_quantity) === 0;
  if (filter === "low_stock") return item.stock_status !== "in_stock";
  if (filter === "expiring") return Boolean(item.expiring_soon);
  if (filter === "review") return item.packaging_status === "needs_review";
  return true;
}
