import type { Metadata } from "next";
import { InventoryList } from "@/components/medicines/inventory-list";
import { requireStaff } from "@/lib/auth";
import { searchQuery } from "@/lib/live-search";
import { loadInventory } from "@/lib/load-inventory";
import { pageNumber } from "@/lib/pagination";
import { canManageOperations } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Inventory" };

export default async function MedicinesPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; page?: string; filter?: string; sort?: string }> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const query = searchQuery(params.q);
  const page = pageNumber(params.page);
  const filter = ["all", "low_stock", "expiring", "review"].includes(params.filter ?? "") ? params.filter! : "all";
  const sort = ["name", "stock", "expiry"].includes(params.sort ?? "") ? params.sort! : "name";
  const catalog = await loadInventory(await createClient());
  return <InventoryList key={JSON.stringify([query, page, filter, sort])} catalog={catalog} initialQuery={query} initialPage={page} filter={filter} sort={sort} manage={canManageOperations(staff.role)} />;
}
