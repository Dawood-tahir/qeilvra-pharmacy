"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Filter, PackagePlus, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSearchRows, useSearchView } from "@/components/ui/use-live-search";
import { medicineSearchFields, rankMedicineMatches } from "@/lib/load-medicine-catalog";
import {
  inventoryExpiryDate, inventoryFilters, inventoryQuickFilters, isBatchExpiryFilter, matchesInventoryFilter,
  parseInventoryFilter, parseInventorySort, type InventoryBatchExpiry, type InventoryFilter, type InventorySort,
} from "@/lib/inventory-filters";
import { NO_SEARCH_MATCHES, searchQuery } from "@/lib/live-search";
import { humanStock, pluralUnit, type StockMedicine } from "@/lib/medicine-units";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

const PAGE_SIZE = 20;
const headings = ["Medicine Name", "Available Stock", "Selling Price", "Expiry Status", "Stock Status", "Actions"];

export function InventoryList({ catalog, batchExpiries, initialQuery, initialPage, filter: initialFilter, sort: initialSort, manage }: {
  catalog: StockMedicine[];
  batchExpiries: InventoryBatchExpiry[] | null;
  initialQuery: string;
  initialPage: number;
  filter: InventoryFilter;
  sort: InventorySort;
  manage: boolean;
}) {
  const { query, page: requestedPage, changeQuery, navigate } = useSearchView(initialQuery, initialPage);
  const [filter, setFilter] = useState(initialFilter);
  const [sort, setSort] = useState(initialSort);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const expiryById = useMemo(() => new Map(batchExpiries?.map((entry) => [entry.medicine_id, entry])), [batchExpiries]);
  const scoped = useMemo(() => {
    const items = catalog.filter((item) => matchesInventoryFilter(item, filter, expiryById.get(item.id)));
    if (sort === "stock") items.sort((a, b) => Number(a.available_quantity) - Number(b.available_quantity));
    if (sort === "expiry") {
      const date = (item: StockMedicine) => inventoryExpiryDate(item, filter, expiryById.get(item.id)) ?? "9999-12-31";
      items.sort((a, b) => date(a).localeCompare(date(b)));
    }
    return items;
  }, [catalog, filter, sort, expiryById]);
  const matches = useSearchRows(scoped, medicineSearchFields, query);
  const term = searchQuery(query).toLowerCase();
  const ordered = useMemo(() => rankMedicineMatches(matches, term), [matches, term]);
  const lastPage = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const page = Math.min(requestedPage, lastPage);
  const items = ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const expiryUnavailable = isBatchExpiryFilter(filter) && !batchExpiries;

  useEffect(() => {
    function restoreFilters() {
      const params = new URLSearchParams(window.location.search);
      setFilter(parseInventoryFilter(params.get("filter")));
      setSort(parseInventorySort(params.get("sort")));
      setFiltersOpen(false);
    }
    window.addEventListener("popstate", restoreFilters);
    return () => window.removeEventListener("popstate", restoreFilters);
  }, []);

  function applyFilter(nextFilter: InventoryFilter) {
    setFilter(nextFilter);
    navigate(1, query, { filter: nextFilter, sort });
  }

  function applySort(nextSort: InventorySort) {
    setSort(nextSort);
    navigate(1, query, { filter, sort: nextSort });
  }

  return (
    <main className="mx-auto max-w-[1450px] p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-blue-700">Your pharmacy</p>
          <h1 className="mt-1 text-3xl font-extrabold">Inventory</h1>
          <p className="mt-1 text-sm text-slate-500">Find a medicine, check stock, or receive a new batch.</p>
        </div>
        {manage && <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Link href="/medicines/new" className={buttonVariants({ size: "lg", className: "flex-1 sm:flex-none" })}><Plus /> Add New Medicine</Link>
          <Link href="/medicines/restock" className={buttonVariants({ variant: "outline", size: "lg", className: "flex-1 sm:flex-none" })}><PackagePlus /> Add More Stock</Link>
        </div>}
      </div>
      <form action="/medicines" onSubmit={(event) => { event.preventDefault(); navigate(1); }} className="q-glass-secondary mt-5 flex min-w-0 flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:flex-wrap">
        <div className="flex min-w-0 flex-1 gap-2 sm:basis-56">
          <div className="relative min-w-0 flex-1">
            <label className="sr-only" htmlFor="inventory-search">Search medicines</label>
            <Search className="absolute left-3 top-3.5 size-5 text-slate-400" />
            <input id="inventory-search" name="q" value={query} maxLength={100} onChange={(event) => changeQuery(event.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm shadow-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Search by name, generic name or barcode" />
          </div>
          <div className="relative shrink-0" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFiltersOpen(false); }} onKeyDown={(event) => {
            if (event.key === "Escape" && filtersOpen) {
              event.preventDefault();
              filterButton.current?.focus();
              setFiltersOpen(false);
            }
          }}>
            <button ref={filterButton} type="button" className={buttonVariants({ size: "lg", variant: filter === "all" ? "outline" : "secondary", className: "px-3 sm:px-4" })} aria-expanded={filtersOpen} aria-controls={filtersOpen ? "inventory-filters" : undefined} onClick={() => setFiltersOpen(!filtersOpen)}>
              <Filter /> Filter
            </button>
            {filtersOpen && <div id="inventory-filters" role="group" aria-label="Inventory filters" className="absolute right-0 top-full z-20 mt-2 w-48 rounded-xl border border-blue-100 bg-white p-1 shadow-lg">
              {inventoryFilters.map(({ value, label }) => (
                <button key={value} type="button" aria-pressed={filter === value} disabled={!batchExpiries && isBatchExpiryFilter(value)} className={cn("w-full rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-blue-50 disabled:opacity-50", filter === value && "bg-blue-50 text-blue-700")} onClick={() => {
                  applyFilter(value);
                  filterButton.current?.focus();
                  setFiltersOpen(false);
                }}>{label}</button>
              ))}
              {!batchExpiries && <p className="px-3 py-2 text-xs text-slate-500">Expiry filters are unavailable.</p>}
            </div>}
          </div>
        </div>
        <input type="hidden" name="filter" value={filter} />
        <label className="flex items-center gap-2 text-sm font-semibold">
          <span>Sort by</span>
          <select name="sort" value={sort} onChange={(event) => applySort(parseInventorySort(event.target.value))} className="h-12 rounded-xl border border-slate-200 bg-white px-3">
            <option value="name">Medicine name</option>
            <option value="stock">Lowest stock</option>
            <option value="expiry">Earliest expiry</option>
          </select>
        </label>
        <Button size="lg" type="submit">Search</Button>
      </form>
      <nav aria-label="Inventory shortcuts" className="mt-4 flex flex-wrap gap-2">
        {inventoryQuickFilters.filter(({ value }) => value !== "review" || manage).map(({ value, label }) => (
          <Link key={value} prefetch={false} href={"/medicines?" + new URLSearchParams({ q: searchQuery(query), filter: value, sort })} aria-current={filter === value ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-xl border px-3 text-sm font-semibold", filter === value ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600")} onClick={(event) => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            applyFilter(value);
          }}>{label}</Link>
        ))}
      </nav>
      <Card className="mt-4 overflow-hidden">
        {items.length > 0 ? <InventoryResults items={items} filter={filter} expiryById={expiryById} /> : (
          <p role="status" className="p-8 text-center text-sm text-slate-500">
            {expiryUnavailable ? "Expiry filters are unavailable." : query.trim() ? NO_SEARCH_MATCHES : "No medicines found. Try another search or filter."}
          </p>
        )}
      </Card>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Page {page}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={page === 1} onClick={() => navigate(page - 1)}><ChevronLeft /> Previous</Button>
          <Button type="button" variant="outline" disabled={page === lastPage} onClick={() => navigate(page + 1)}>Next <ChevronRight /></Button>
        </div>
      </div>
      {manage && <details className="mt-6 text-sm">
        <summary className="cursor-pointer font-semibold text-slate-500">Advanced inventory actions</summary>
        <div className="mt-3 flex flex-wrap gap-4">
          <Link className="text-blue-700" href="/stock">Correct Stock</Link>
          <Link className="text-blue-700" href="/purchases">Purchase History</Link>
        </div>
      </details>}
    </main>
  );
}

function InventoryResults({ items, filter, expiryById }: {
  items: readonly StockMedicine[];
  filter: InventoryFilter;
  expiryById: ReadonlyMap<string, InventoryBatchExpiry>;
}) {
  const expired = filter === "expired";
  const expiryClass = (soon?: boolean) => expired ? "font-semibold text-red-700" : soon ? "font-semibold text-amber-700" : "text-slate-600";
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr>{headings.map((heading) => <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>)}</tr></thead>
          <tbody>
            {items.map((item) => {
              const expiry = inventoryExpiryDate(item, filter, expiryById.get(item.id));
              return (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-4 py-4">
                    <p className="font-bold">{item.name} {item.strength}</p>
                    <p className="mt-1 text-xs text-slate-500">{[item.generic_name, item.manufacturer].filter(Boolean).join(" / ")}</p>
                    {item.packaging_status !== "confirmed" && <span className="mt-1 block text-xs font-semibold text-amber-700">Packaging needs Owner review</span>}
                  </td>
                  <td className="px-4 py-4"><strong>{humanStock(item.available_quantity, item.base_unit, item.units)}</strong>{item.units.length > 1 && <p className="mt-1 text-xs text-slate-500">{pluralUnit(item.base_unit, item.available_quantity)} total</p>}</td>
                  <td className="px-4 py-4"><strong>{formatCurrency(item.selling_price)}</strong><p className="text-xs text-slate-500">per {item.base_unit}</p></td>
                  <td className="px-4 py-4"><span className={expiryClass(item.expiring_soon && expiry === item.nearest_expiry)}>{expiry ? formatDate(expiry) : "No sellable stock"}</span></td>
                  <td className="px-4 py-4"><Badge variant={item.stock_status === "in_stock" ? "success" : item.stock_status === "low_stock" ? "warning" : "destructive"}>{item.stock_status.replaceAll("_", " ")}</Badge></td>
                  <td className="px-4 py-4"><Link prefetch={false} className="inline-flex min-h-11 items-center font-bold text-blue-700" href={"/medicines/" + item.id}>View Details</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-slate-100 md:hidden">
        {items.map((item) => {
          const expiry = inventoryExpiryDate(item, filter, expiryById.get(item.id));
          const soon = item.expiring_soon && expiry === item.nearest_expiry;
          const dateLabel = expired ? "Expired " : soon ? "Expiring soon: " : "Expires ";
          return (
            <article key={item.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-extrabold">{item.name} {item.strength}</h2>
                <Badge variant={item.stock_status === "in_stock" ? "success" : "warning"}>{item.stock_status.replaceAll("_", " ")}</Badge>
              </div>
              <p className="mt-2 text-sm font-bold">{humanStock(item.available_quantity, item.base_unit, item.units)}</p>
              <p className="mt-1 text-sm text-slate-600">{formatCurrency(item.selling_price)} / {item.base_unit}</p>
              <p className={cn("mt-1 text-xs", expiryClass(soon))}>{expiry ? dateLabel + formatDate(expiry) : "No sellable stock"}</p>
              {item.packaging_status !== "confirmed" && <p className="mt-2 text-xs font-semibold text-amber-700">Packaging needs Owner review</p>}
              <Link prefetch={false} className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-blue-700" href={"/medicines/" + item.id}>View Details <ChevronRight className="ml-1 size-4" /></Link>
            </article>
          );
        })}
      </div>
    </>
  );
}
