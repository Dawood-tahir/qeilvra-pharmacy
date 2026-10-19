"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { CompleteReturn } from "@/components/returns/complete-return";
import { pendingReturnSchema, returnSaleSchema, returnStorageKey, type CompleteReturnInput, type ReturnSale } from "@/lib/instant-return";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export function ReturnLookup({ staffId, initialSaleId, onClose, onReturned }: { staffId: string; initialSaleId?: string; onClose: () => void; onReturned?: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState(""); const [date, setDate] = useState("");
  const [invoices, setInvoices] = useState<ReturnSale[]>([]);
  const [invoice, setInvoice] = useState<ReturnSale | null>(null);
  const [initialRequest, setInitialRequest] = useState<CompleteReturnInput>();
  const [page, setPage] = useState(1); const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [locked, setLocked] = useState(false);
  const [error, setError] = useState(""); const [result, setResult] = useState<{ returnNumber: string; refund: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  async function find(nextPage: number, term: string, day: string, saleId?: string) {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setLoading(true); setError(""); setPage(nextPage); setInvoices([]); setHasMore(false);
    try {
      const response = await fetch("/api/returns/invoice?" + new URLSearchParams({ q: term.trim(), date: day, page: String(nextPage), ...(saleId ? { sale: saleId } : {}) }), { cache: "no-store", signal: request.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const parsed = returnSaleSchema.array().safeParse(data.sales);
      if (!parsed.success) throw new Error("Sales could not be loaded. Please refresh and try again.");
      if (request.signal.aborted) return;
      const sales = parsed.data; setInvoices(sales); setHasMore(Boolean(data.hasMore));
      if (saleId && sales[0]) setInvoice(sales[0]);
    } catch (e) { if (!request.signal.aborted) setError(e instanceof Error ? e.message : "Could not load recent sales."); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
    if (!active) return;
    try {
      const raw = sessionStorage.getItem(returnStorageKey(staffId));
      if (raw) {
        const saved = pendingReturnSchema.parse(JSON.parse(raw));
        setInvoice(saved.invoice); setInitialRequest(saved.input); setLocked(true); setLoading(false); return;
      }
    } catch { setError("An unfinished return could not be read. Check return history before starting another refund."); setLoading(false); setLocked(true); return; }
    void find(1, "", "", initialSaleId);
    });
    return () => { active = false; controller.current?.abort(); };
  }, [staffId, initialSaleId]);
  return <Dialog label="Return / Refund" busy={busy} onClose={onClose}>
    <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-extrabold">Return / Refund</h2><Button aria-label="Close returns" size="icon" variant="ghost" disabled={busy} onClick={onClose}><X /></Button></div>
    {result ? <section role="status" className="space-y-4 py-4 text-center"><CheckCircle2 className="mx-auto size-12 text-emerald-600" /><h3 className="text-xl font-extrabold">Return completed</h3><p className="break-all text-sm">{result.returnNumber}</p><p className="text-xl font-bold">Refund: {formatCurrency(result.refund)}</p><Button onClick={() => { setResult(null); void find(1, query, date); }}>Back to recent sales</Button></section> : invoice ? <>
      <Button variant="ghost" size="sm" className="mb-3" disabled={busy || locked} onClick={() => { setInvoice(null); setInitialRequest(undefined); void find(page, query, date); }}>Back to recent sales</Button>
      <CompleteReturn key={invoice.id} staffId={staffId} invoice={invoice} initialRequest={initialRequest} onBusy={setBusy} onLocked={setLocked} onCompleted={(value) => { setResult(value); setInvoice(null); setLocked(false); setInitialRequest(undefined); router.refresh(); onReturned?.(); }} />
    </> : <>
      <p className="mb-3 text-sm text-slate-600">Choose a recent sale below. You can also search by invoice or medicine, or choose a sale date.</p>
      <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void find(1, query, date); }}><label className="min-w-0 flex-1 text-xs font-semibold">Invoice or medicine (optional)<Input className="mt-1" maxLength={100} value={query} disabled={locked} onChange={(event) => setQuery(event.target.value)} placeholder="Invoice number or medicine name" /></label><label className="text-xs font-semibold">Sale date (optional)<Input className="mt-1" type="date" value={date} disabled={locked} onChange={(event) => setDate(event.target.value)} /></label><Button disabled={locked}><Search />Search</Button></form>
      {loading ? <p role="status" className="py-6 text-center text-sm text-slate-500">Loading recent sales...</p> : <div className="space-y-2">{invoices.map((entry) => <button key={entry.id} disabled={locked} className="w-full rounded-xl border border-slate-200 p-3 text-left text-sm hover:border-blue-400 hover:bg-blue-50" onClick={() => setInvoice(entry)}><span className="flex flex-wrap justify-between gap-2 font-bold"><span>{entry.invoice_number}</span><span>{formatCurrency(entry.net_total)}</span></span><span className="mt-1 block text-xs text-slate-500">{formatDateTime(entry.completed_at)} · {entry.cashier}</span><span className="mt-1 block break-words text-xs">{entry.sale_items.slice(0, 3).map((item) => item.medicine_name + " · " + item.quantity + " " + item.unit_label).join(", ")}</span></button>)}{!invoices.length && !error && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No matching sales. Clear the search or choose another date.</p>}</div>}
      {!loading && !locked && !error && <div className="mt-3 flex items-center justify-between gap-2 text-sm">{page > 1 ? <Button size="sm" variant="outline" onClick={() => void find(page - 1, query, date)}>Previous</Button> : <span />}<span>Page {page}</span>{hasMore ? <Button size="sm" variant="outline" onClick={() => void find(page + 1, query, date)}>Next</Button> : <span />}</div>}
    </>}
    {error && <div role="alert" className="mt-3 text-sm text-red-700"><p>{error}</p>{!locked && !loading && <Button className="mt-2" variant="outline" onClick={() => void find(page, query, date, initialSaleId)}>Retry</Button>}</div>}
    <Link href="/returns" className="mt-4 block text-center text-sm font-semibold text-blue-700">View return history</Link>
  </Dialog>;
}
