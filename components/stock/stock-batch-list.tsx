"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, PackageX, Search } from "lucide-react";
import { StockActions } from "@/components/stock/stock-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useSearchRows, useSearchView } from "@/components/ui/use-live-search";
import { NO_SEARCH_MATCHES, searchQuery } from "@/lib/live-search";
import { formatCurrency, formatDate } from "@/lib/utils";

const PAGE_SIZE = 30;

export type StockBatch = {
  id: string;
  supplier_id: string | null;
  batch_number: string;
  expiry_date: string;
  quantity_on_hand: number;
  purchase_cost: number | string;
  is_quarantined: boolean;
  medicines: { id: string; name: string; generic_name: string | null; strength: string | null; sku: string; base_unit: string };
  suppliers: { name: string } | null;
  purchase_items?: { purchases: { supplier_id: string | null; suppliers: { name: string } | null } } | null;
};

type Supplier = { id: string; name: string };

type StockBatchListProps = {
  batches: StockBatch[];
  suppliers: Supplier[];
  staffId: string;
  today: string;
  initialQuery: string;
  initialPage: number;
  filters: Record<string, string | undefined>;
};

const batchFields = ({ batch_number, medicines }: StockBatch) => [batch_number, medicines.name, medicines.generic_name, medicines.sku];

export function StockBatchList({ batches, suppliers, staffId, today, initialQuery, initialPage, filters }: StockBatchListProps) {
  const { query, page: requestedPage, changeQuery, navigate } = useSearchView(initialQuery, initialPage);
  const term = searchQuery(query);
  const matches = useSearchRows(batches, batchFields, query);
  const lastPage = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const page = Math.min(requestedPage, lastPage);
  const visibleBatches = matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <form action="/stock" className="mt-5 flex gap-2" onSubmit={(event) => {
        event.preventDefault();
        navigate(1);
      }}>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-3.5 size-5 text-slate-400" />
          <input
            aria-label="Search medicine or batch number"
            name="q"
            value={query}
            maxLength={100}
            onChange={(event) => changeQuery(event.target.value)}
            className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            placeholder="Medicine or batch number"
          />
        </div>
        {Object.entries(filters).map(([name, value]) => value && (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Button size="lg" type="submit">Search</Button>
      </form>
      <Card className="mt-4 overflow-hidden">
        <CardContent className="p-0">
          {visibleBatches.length === 0 ? (
            <EmptyState
              icon={PackageX}
              title={term ? NO_SEARCH_MATCHES : "No stock batches found"}
              description={term ? "Try a different medicine or batch number." : "Use Add More Stock in Inventory to receive a batch."}
            />
          ) : (
            <BatchResults batches={visibleBatches} staffId={staffId} suppliers={suppliers} today={today} />
          )}
        </CardContent>
      </Card>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-xs text-slate-500">{matches.length} batches · Page {page}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={page === 1} onClick={() => navigate(page - 1)}>
            <ChevronLeft /> Previous
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={page === lastPage} onClick={() => navigate(page + 1)}>
            Next <ChevronRight />
          </Button>
        </div>
      </div>
    </>
  );
}

function BatchResults({ batches, staffId, suppliers, today }: Pick<StockBatchListProps, "batches" | "staffId" | "suppliers" | "today">) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3">Medicine</th>
              <th className="px-4 py-3">Batch</th>
              <th className="px-4 py-3">Expiry</th>
              <th className="px-4 py-3">Supplier</th>
              <th className="px-4 py-3">Quantity</th>
              <th className="px-4 py-3">Unit cost</th>
              <th className="px-4 py-3">Status</th>
              <th className="relative px-4 py-3"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {batches.map((row) => {
              const med = row.medicines;
              const supplier = row.suppliers ?? row.purchase_items?.purchases?.suppliers;
              const expired = row.expiry_date < today;
              return (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-5 py-3">
                    <Link prefetch={false} className="font-bold hover:text-blue-700" href={"/medicines/" + med.id}>{med.name} {med.strength}</Link>
                    <p className="text-xs text-slate-500">{med.sku}</p>
                  </td>
                  <td className="px-4 py-3 font-medium">{row.batch_number}</td>
                  <td className="px-4 py-3">{formatDate(row.expiry_date)}</td>
                  <td className="px-4 py-3">{supplier?.name ?? "—"}</td>
                  <td className="px-4 py-3 font-extrabold">{row.quantity_on_hand} <span className="font-normal text-slate-500">{med.base_unit}</span></td>
                  <td className="px-4 py-3">{formatCurrency(row.purchase_cost)}</td>
                  <td className="px-4 py-3"><BatchStatus row={row} expired={expired} /></td>
                  <td className="px-4 py-3"><BatchActions row={row} staffId={staffId} suppliers={suppliers} expired={expired} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-slate-100 md:hidden">
        {batches.map((row) => {
          const med = row.medicines;
          const supplier = row.suppliers ?? row.purchase_items?.purchases?.suppliers;
          const expired = row.expiry_date < today;
          return (
            <article key={row.id} className="p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <Link prefetch={false} href={"/medicines/" + med.id} className="min-w-0 break-words font-bold text-blue-700">{med.name} {med.strength}</Link>
                <BatchStatus row={row} expired={expired} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="min-w-0"><dt className="text-xs text-slate-500">Batch</dt><dd className="break-words font-semibold">{row.batch_number}</dd></div>
                <div><dt className="text-xs text-slate-500">Expiry</dt><dd>{formatDate(row.expiry_date)}</dd></div>
                <div><dt className="text-xs text-slate-500">Quantity</dt><dd className="font-bold">{row.quantity_on_hand} {med.base_unit}s</dd></div>
                <div><dt className="text-xs text-slate-500">Purchase cost per {med.base_unit}</dt><dd>{formatCurrency(row.purchase_cost)}</dd></div>
                <div className="col-span-2 min-w-0"><dt className="text-xs text-slate-500">Supplier</dt><dd className="break-words">{supplier?.name ?? "Supplier not recorded"}</dd></div>
              </dl>
              <div className="mt-3 border-t pt-2"><BatchActions row={row} staffId={staffId} suppliers={suppliers} expired={expired} /></div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function BatchStatus({ row, expired }: { row: StockBatch; expired: boolean }) {
  const empty = Number(row.quantity_on_hand) <= 0;
  return (
    <Badge variant={row.is_quarantined || expired ? "destructive" : empty ? "neutral" : "success"}>
      {row.is_quarantined ? "Quarantined" : expired ? "Expired" : empty ? "Empty" : "Sellable"}
    </Badge>
  );
}

function BatchActions({ row, staffId, suppliers, expired }: { row: StockBatch; staffId: string; suppliers: Supplier[]; expired: boolean }) {
  const origin = row.purchase_items?.purchases;
  return (
    <StockActions
      staffId={staffId}
      batchId={row.id}
      medicine={row.medicines.name + " " + (row.medicines.strength ?? "")}
      batch={row.batch_number}
      quantity={Number(row.quantity_on_hand)}
      unit={row.medicines.base_unit}
      cost={row.purchase_cost}
      supplierId={row.supplier_id ?? origin?.supplier_id ?? null}
      supplierName={row.suppliers?.name ?? origin?.suppliers?.name}
      suppliers={suppliers}
      expired={expired}
    />
  );
}
