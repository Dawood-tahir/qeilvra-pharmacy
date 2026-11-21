"use client";

import { useMemo, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, PackagePlus, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSearchRows, useSearchView } from "@/components/ui/use-live-search";
import { medicineSearchFields, rankMedicineMatches } from "@/lib/load-medicine-catalog";
import { NO_SEARCH_MATCHES, searchQuery } from "@/lib/live-search";
import { humanStock, pluralUnit, type StockMedicine } from "@/lib/medicine-units";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

export function InventoryList({ catalog, initialQuery, initialPage, filter, sort, manage }: {
  catalog: StockMedicine[];
  initialQuery: string;
  initialPage: number;
  filter: string;
  sort: string;
  manage: boolean;
}) {
  const router = useRouter();
  const { query, page: requestedPage, changeQuery, navigate } = useSearchView(initialQuery, initialPage);
  const scoped = useMemo(() => {
    const items = catalog.filter((item) => {
      if (filter === "low_stock") return item.stock_status !== "in_stock";
      if (filter === "expiring") return item.expiring_soon;
      if (filter === "review") return item.packaging_status === "needs_review";
      return true;
    });
    if (sort === "stock") items.sort((a, b) => Number(a.available_quantity) - Number(b.available_quantity));
    if (sort === "expiry") items.sort((a, b) => (a.nearest_expiry ?? "9999-12-31").localeCompare(b.nearest_expiry ?? "9999-12-31"));
    return items;
  }, [catalog, filter, sort]);
  const matches = useSearchRows(scoped, medicineSearchFields, query);
  const term = searchQuery(query).toLowerCase();
  const ordered = useMemo(() => rankMedicineMatches(matches, term), [matches, term]);
  const pageSize = 20;
  const lastPage = Math.max(1, Math.ceil(ordered.length / pageSize));
  const page = Math.min(requestedPage, lastPage);
  const items = ordered.slice((page - 1) * pageSize, page * pageSize);
  const href = (next: number, nextFilter = filter, nextSort = sort) => "/medicines?" + new URLSearchParams({ q: searchQuery(query), page: String(next), filter: nextFilter, sort: nextSort });

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSort = String(new FormData(event.currentTarget).get("sort"));
    if (nextSort === sort) navigate(1);
    else router.push(href(1, filter, nextSort), { scroll: false });
  }

  return <main className="mx-auto max-w-[1450px] p-4 sm:p-6 lg:p-8">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-blue-700">Your pharmacy</p><h1 className="mt-1 text-3xl font-extrabold">Inventory</h1><p className="mt-1 text-sm text-slate-500">Find a medicine, check stock, or receive a new batch.</p></div>{manage && <div className="flex w-full flex-wrap gap-2 sm:w-auto"><Link href="/medicines/new" className={buttonVariants({ size: "lg", className: "flex-1 sm:flex-none" })}><Plus /> Add New Medicine</Link><Link href="/medicines/restock" className={buttonVariants({ variant: "outline", size: "lg", className: "flex-1 sm:flex-none" })}><PackagePlus /> Add More Stock</Link></div>}</div>
    <form action="/medicines" onSubmit={applySearch} className="q-glass-secondary mt-5 flex min-w-0 flex-col gap-3 rounded-2xl border p-3 sm:flex-row"><div className="relative min-w-0 flex-1"><label className="sr-only" htmlFor="inventory-search">Search medicines</label><Search className="absolute left-3 top-3.5 size-5 text-slate-400" /><input id="inventory-search" name="q" value={query} maxLength={100} onChange={(event) => changeQuery(event.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm shadow-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Search by name, generic name or barcode" /></div><input type="hidden" name="filter" value={filter} /><label className="flex items-center gap-2 text-sm font-semibold"><span>Sort by</span><select name="sort" defaultValue={sort} className="h-12 rounded-xl border border-slate-200 bg-white px-3"><option value="name">Medicine name</option><option value="stock">Lowest stock</option><option value="expiry">Earliest expiry</option></select></label><button className={buttonVariants({ size: "lg" })}>Search</button></form>
    <nav aria-label="Inventory filters" className="mt-4 flex flex-wrap gap-2">{[["all", "All Medicines"], ["low_stock", "View Low Stock"], ["expiring", "View Expiring Medicines"], ...(manage ? [["review", "Packaging to Review"]] : [])].map(([key, label]) => <Link key={key} prefetch={false} href={href(1, key)} aria-current={filter === key ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-xl border px-3 text-sm font-semibold", filter === key ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600")}>{label}</Link>)}</nav>
    <Card className="mt-4 overflow-hidden">{!items.length ? <p className="p-8 text-center text-sm text-slate-500">{query.trim() ? NO_SEARCH_MATCHES : "No medicines found. Try another search or filter."}</p> : <><div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["Medicine Name", "Available Stock", "Selling Price", "Expiry Status", "Stock Status", "Actions"].map((t) => <th key={t} className="px-4 py-3 font-semibold">{t}</th>)}</tr></thead><tbody>{items.map((m) => <tr key={m.id} className="border-t border-slate-100"><td className="px-4 py-4"><p className="font-bold">{m.name} {m.strength}</p><p className="mt-1 text-xs text-slate-500">{[m.generic_name, m.manufacturer].filter(Boolean).join(" / ")}</p>{m.packaging_status !== "confirmed" && <span className="mt-1 block text-xs font-semibold text-amber-700">Packaging needs Owner review</span>}</td><td className="px-4 py-4"><strong>{humanStock(m.available_quantity, m.base_unit, m.units)}</strong>{m.units.length > 1 && <p className="mt-1 text-xs text-slate-500">{pluralUnit(m.base_unit, m.available_quantity)} total</p>}</td><td className="px-4 py-4"><strong>{formatCurrency(m.selling_price)}</strong><p className="text-xs text-slate-500">per {m.base_unit}</p></td><td className="px-4 py-4"><span className={m.expiring_soon ? "font-semibold text-amber-700" : "text-slate-600"}>{m.nearest_expiry ? formatDate(m.nearest_expiry) : "No sellable stock"}</span></td><td className="px-4 py-4"><Badge variant={m.stock_status === "in_stock" ? "success" : m.stock_status === "low_stock" ? "warning" : "destructive"}>{m.stock_status.replaceAll("_", " ")}</Badge></td><td className="px-4 py-4"><Link prefetch={false} className="inline-flex min-h-11 items-center font-bold text-blue-700" href={"/medicines/" + m.id}>View Details</Link></td></tr>)}</tbody></table></div><div className="divide-y divide-slate-100 md:hidden">{items.map((m) => <article key={m.id} className="p-4"><div className="flex items-start justify-between gap-2"><h2 className="font-extrabold">{m.name} {m.strength}</h2><Badge variant={m.stock_status === "in_stock" ? "success" : "warning"}>{m.stock_status.replaceAll("_", " ")}</Badge></div><p className="mt-2 text-sm font-bold">{humanStock(m.available_quantity, m.base_unit, m.units)}</p><p className="mt-1 text-sm text-slate-600">{formatCurrency(m.selling_price)} / {m.base_unit}</p><p className={cn("mt-1 text-xs", m.expiring_soon ? "font-semibold text-amber-700" : "text-slate-500")}>{m.nearest_expiry ? (m.expiring_soon ? "Expiring soon: " : "Expires ") + formatDate(m.nearest_expiry) : "No sellable stock"}</p>{m.packaging_status !== "confirmed" && <p className="mt-2 text-xs font-semibold text-amber-700">Packaging needs Owner review</p>}<Link prefetch={false} className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-blue-700" href={"/medicines/" + m.id}>View Details <ChevronRight className="ml-1 size-4" /></Link></article>)}</div></>}</Card>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">Page {page}</p><div className="flex gap-2"><Button type="button" variant="outline" disabled={page === 1} onClick={() => navigate(page - 1)}><ChevronLeft /> Previous</Button><Button type="button" variant="outline" disabled={page === lastPage} onClick={() => navigate(page + 1)}>Next <ChevronRight /></Button></div></div>
    {manage && <details className="mt-6 text-sm"><summary className="cursor-pointer font-semibold text-slate-500">Advanced inventory actions</summary><div className="mt-3 flex flex-wrap gap-4"><Link className="text-blue-700" href="/stock">Correct Stock</Link><Link className="text-blue-700" href="/purchases">Purchase History</Link></div></details>}
  </main>;
}
