"use client";

import Link from "next/link";
import { Building2, Mail, MapPin, Phone, Truck } from "lucide-react";
import { setSupplierActiveAction } from "@/app/(app)/suppliers/actions";
import { ActionForm } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { LivePagination } from "@/components/ui/live-pagination";
import { useSearchRows, useSearchView } from "@/components/ui/use-live-search";
import { NO_SEARCH_MATCHES } from "@/lib/live-search";
import { HISTORY_PAGE_SIZE } from "@/lib/pagination";

export type DirectorySupplier = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  is_active: boolean;
};

const supplierFields = (supplier: DirectorySupplier) => [supplier.name];

export function SupplierDirectory({ records, initialQuery, initialPage }: {
  records: DirectorySupplier[];
  initialQuery: string;
  initialPage: number;
}) {
  const { query, page: requestedPage, changeQuery, navigate } = useSearchView(initialQuery, initialPage);
  const matches = useSearchRows(records, supplierFields, query);
  const lastPage = Math.max(1, Math.ceil(matches.length / HISTORY_PAGE_SIZE));
  const page = Math.min(requestedPage, lastPage);
  const suppliers = matches.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);
  return <><form action="/suppliers" onSubmit={(event) => { event.preventDefault(); navigate(1); }} className="mt-4 flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1"><span className="mb-1 block text-sm font-semibold">Search suppliers</span><Input name="q" value={query} maxLength={100} onChange={(event) => changeQuery(event.target.value)} placeholder="Supplier name" /></label><Button variant="outline">Search</Button>{query && <button type="button" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-blue-700" onClick={() => navigate(1, "")}>Clear</button>}</form><Card className="mt-4"><CardContent className="p-0">{suppliers.length === 0 ? <EmptyState icon={Truck} title={query ? NO_SEARCH_MATCHES : "No suppliers yet"} description={query ? "Try another supplier name or clear the search." : "Add your supplier to select it when receiving stock."} /> : <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">{suppliers.map((supplier) => <article key={supplier.id} className="q-glass-secondary min-w-0 rounded-2xl border transition-colors hover:border-blue-300"><Link prefetch={false} href={`/suppliers/${supplier.id}`} className="block min-w-0 rounded-t-2xl p-4 focus-visible:outline-2 focus-visible:outline-blue-600"><div className="flex items-start justify-between gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><Building2 /></span><Badge variant={supplier.is_active ? "success" : "neutral"}>{supplier.is_active ? "Active" : "Inactive"}</Badge></div><h2 className="mt-4 break-words font-extrabold">{supplier.name}</h2><p className="mt-1 break-words text-xs text-slate-500">{supplier.contact_person || "No contact person"}{supplier.tax_number ? ` · Tax ${supplier.tax_number}` : ""}</p><div className="mt-4 space-y-2 text-sm text-slate-600">{supplier.phone && <p className="flex min-w-0 gap-2 break-words"><Phone className="size-4 shrink-0" /> {supplier.phone}</p>}{supplier.email && <p className="flex min-w-0 gap-2 break-all"><Mail className="size-4 shrink-0" /> {supplier.email}</p>}{supplier.address && <p className="flex min-w-0 gap-2 break-words"><MapPin className="size-4 shrink-0" /> {supplier.address}</p>}</div><span className="mt-4 inline-flex min-h-11 items-center text-sm font-bold text-blue-700">View Details<span className="sr-only"> for {supplier.name}</span></span></Link><ActionForm action={setSupplierActiveAction} className="mx-4 border-t py-3"><input type="hidden" name="id" value={supplier.id} /><input type="hidden" name="active" value={String(!supplier.is_active)} /><Button variant="ghost" size="sm" className={supplier.is_active ? "text-red-600" : "text-emerald-700"}>{supplier.is_active ? "Deactivate" : "Reactivate"}</Button></ActionForm></article>)}</div>}</CardContent></Card><LivePagination page={page} lastPage={lastPage} onChange={navigate} /></>;
}
