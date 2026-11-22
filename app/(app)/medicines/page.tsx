import type { Metadata } from "next";
import { InventoryList } from "@/components/medicines/inventory-list";
import { requireStaff } from "@/lib/auth";
import { searchQuery } from "@/lib/live-search";
import { parseInventoryFilter, parseInventorySort } from "@/lib/inventory-filters";
import { loadInventory, loadInventoryBatchExpiries } from "@/lib/load-inventory";
import { pageNumber } from "@/lib/pagination";
import { canManageOperations } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Inventory" };

export default async function MedicinesPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; page?: string; filter?: string; sort?: string }> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const query = searchQuery(params.q);
  const page = pageNumber(params.page);
  const filter = parseInventoryFilter(params.filter);
  const sort = parseInventorySort(params.sort);
  const client = await createClient();
  const catalog = await loadInventory(client);
  const batchExpiries = await loadInventoryBatchExpiries(client, catalog.map(({ id }) => id));
  return <InventoryList key={JSON.stringify([query, page, filter, sort])} catalog={catalog} batchExpiries={batchExpiries} initialQuery={query} initialPage={page} filter={filter} sort={sort} manage={canManageOperations(staff.role)} />;
}
