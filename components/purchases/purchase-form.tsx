"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LoaderCircle, PackagePlus, Plus, Search, Trash2 } from "lucide-react";
import { createPurchaseAction } from "@/app/(app)/purchases/actions";
import { SupplierSelect, type SupplierOption } from "@/components/purchases/supplier-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pluralUnit, toMinor, type SellingUnit } from "@/lib/medicine-units";
import { formatCurrency, localDateISO } from "@/lib/utils";

type Medicine = { id: string; name: string; strength?: string; sku: string; base_unit: string; units: SellingUnit[]; packaging_status: string };
type PurchaseItem = Medicine & { rowId: string; batch_number: string; expiry_date: string; quantity: number; unit_cost: number; unit_key: string };

export function PurchaseForm({ suppliers }: { suppliers: SupplierOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchVersion, setSearchVersion] = useState(0);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(localDateISO());
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const busy = useRef(false);
  const subtotal = useMemo(() => items.reduce((sum, item) => sum + item.quantity * toMinor(item.unit_cost) / 100, 0), [items]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (query.trim().length < 2) { setResults([]); setSearchError(""); setLoading(false); return; }
      setLoading(true); setSearchError("");
      try {
        const response = await fetch("/api/medicines/search?q=" + encodeURIComponent(query) + "&limit=8", { signal: controller.signal });
        if (!response.ok) throw new Error();
        setResults(await response.json());
      } catch { if (!controller.signal.aborted) setSearchError("Could not find medicines. Check your connection and try again."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, searchVersion]);
  const add = (medicine: Medicine) => {
    if (medicine.packaging_status !== "confirmed") { toast.error("Confirm this medicine packaging in Inventory first."); return; }
    setItems((current) => [...current, { ...medicine, rowId: crypto.randomUUID(), batch_number: "", expiry_date: "", unit_key: "base", quantity: 1, unit_cost: 0 }]); setQuery(""); setResults([]);
  };
  const update = (rowId: string, patch: Partial<PurchaseItem>) => setItems((current) => current.map((item) => item.rowId === rowId ? { ...item, ...patch } : item));
  const submit = () => {
    if (busy.current || uncertain) return;
    if (!supplierId) { setError("Choose a saved supplier."); return; }
    busy.current = true; setError("");
    startTransition(async () => {
      try {
        const result = await createPurchaseAction({ supplier_id: supplierId, supplier_invoice_number: invoiceNumber, invoice_date: invoiceDate, discount, notes, items: items.map(({ id, batch_number, expiry_date, quantity, unit_cost, unit_key }) => ({ medicine_id: id, batch_number, expiry_date, quantity, unit_cost, unit_key })) });
        if (!result.ok) { setError(result.error); setUncertain(Boolean(result.uncertain)); busy.current = Boolean(result.uncertain); return; }
        setSavedId(result.id);
        toast.success("Draft saved. Review it, then post it to add stock."); router.push("/purchases/" + result.id); router.refresh();
      } catch { setUncertain(true); setError("Could not confirm the draft. Check Purchases for this invoice before entering it again."); }
      finally { /* Keep the successful submission locked while opening its saved draft. */ }
    });
  };
  return <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="space-y-5">
    <fieldset disabled={pending || uncertain || Boolean(savedId)} className="space-y-5">
      <section aria-label="Supplier invoice" className="grid gap-4 sm:grid-cols-2">
        <SupplierSelect suppliers={suppliers} value={supplierId} onChange={setSupplierId} required />
        <label><span className="mb-2 block text-sm font-semibold">Supplier invoice number (optional)</span><Input value={invoiceNumber} maxLength={120} onChange={(e) => setInvoiceNumber(e.target.value)} /></label>
        <label><span className="mb-2 block text-sm font-semibold">Invoice date *</span><Input type="date" required value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></label>
        <label><span className="mb-2 block text-sm font-semibold">Invoice discount (Rs.)</span><Input type="number" inputMode="decimal" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} /></label>
      </section>
      <section aria-label="Purchased medicines"><h2 className="font-bold">Medicines received</h2><label className="mt-3 block"><span className="mb-2 block text-sm font-semibold">Find a medicine</span><span className="relative block"><Search className="absolute left-3 top-3.5 size-4 text-slate-400" /><Input className="pl-10" value={query} onChange={(e) => { setQuery(e.target.value); setResults([]); setSearchError(""); setLoading(e.target.value.trim().length >= 2); }} placeholder="Search by name or barcode" /></span></label>
        {loading && <p role="status" className="mt-2 text-sm text-slate-500">Finding medicines...</p>}
        {searchError && <div role="alert" className="mt-2 text-sm text-red-700">{searchError}<Button type="button" variant="ghost" onClick={() => setSearchVersion((n) => n + 1)}>Try again</Button></div>}
        {results.length > 0 && <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border bg-white">{results.map((medicine) => <button type="button" key={medicine.id} onClick={() => add(medicine)} className="flex min-h-12 w-full items-center justify-between gap-2 p-3 text-left hover:bg-blue-50"><span><span className="block text-sm font-bold">{medicine.name} {medicine.strength}</span><span className="text-xs text-slate-500">{medicine.sku}</span></span><Plus className="size-4 shrink-0 text-blue-600" /></button>)}</div>}
        {!loading && !searchError && query.trim().length >= 2 && !results.length && <p className="mt-2 text-sm text-slate-500">No medicines found. Try another name or barcode.</p>}
        <div className="mt-3 space-y-3">{!items.length && <p className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Search for a saved medicine to add it to this invoice.</p>}{items.map((item) => {
          const unit = item.units.find((u) => u.unit_key === item.unit_key);
          return <article key={item.rowId} aria-label={item.name + " purchase item"} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-bold">{item.name} {item.strength}</h3><p className="text-xs text-slate-500">{item.sku}</p></div><Button type="button" size="icon" variant="ghost" aria-label={"Remove " + item.name} onClick={() => setItems((current) => current.filter((x) => x.rowId !== item.rowId))}><Trash2 /></Button></div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label><span className="mb-1 block text-sm font-semibold">Purchased unit</span><select value={item.unit_key} onChange={(e) => update(item.rowId, { unit_key: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3">{item.units.map((u) => <option key={u.unit_key} value={u.unit_key}>{u.label}</option>)}</select></label>
              <label><span className="mb-1 block text-sm font-semibold">Quantity received *</span><Input required type="number" min="1" step="1" inputMode="numeric" value={item.quantity} onChange={(e) => update(item.rowId, { quantity: Number(e.target.value) })} /></label>
              <label><span className="mb-1 block text-sm font-semibold">Cost of 1 {unit?.label} (Rs.) *</span><Input required type="number" inputMode="decimal" min="0" step="0.01" value={item.unit_cost} onChange={(e) => update(item.rowId, { unit_cost: Number(e.target.value) })} /></label>
              <label><span className="mb-1 block text-sm font-semibold">Batch number *</span><Input required maxLength={80} value={item.batch_number} onChange={(e) => update(item.rowId, { batch_number: e.target.value })} /></label>
              <label><span className="mb-1 block text-sm font-semibold">Expiry date *</span><Input required type="date" value={item.expiry_date} onChange={(e) => update(item.rowId, { expiry_date: e.target.value })} /></label>
            </div>
            <div className="mt-3 flex flex-wrap justify-between gap-2 rounded-lg bg-blue-50 p-3 text-sm"><span>Stock to add: <strong>{pluralUnit(item.base_unit, item.quantity * (unit?.base_quantity ?? 0))}</strong></span><strong>Total cost: {formatCurrency(item.quantity * toMinor(item.unit_cost) / 100)}</strong></div>
          </article>;
        })}</div>
      </section>
      <details><summary className="min-h-11 cursor-pointer text-sm font-semibold text-slate-600">Add a note (optional)</summary><label className="block"><span className="mb-2 block text-sm font-semibold">Notes</span><textarea value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} className="min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm" /></label></details>
    </fieldset>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}{uncertain && <Link className="mt-1 block font-bold underline" href="/purchases">View Purchases</Link>}</p>}
    {savedId && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Draft saved. <Link className="font-bold underline" href={"/purchases/" + savedId}>Open draft to review and post stock</Link></p>}
    <div className="q-topbar sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 rounded-xl border-t border-slate-200 px-3 py-3 lg:bottom-0"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-slate-500">Draft total</p><p className="text-2xl font-extrabold">{formatCurrency(Math.max(subtotal - discount, 0))}</p></div><Button size="lg" disabled={pending || uncertain || Boolean(savedId) || !supplierId || !items.length}>{pending ? <LoaderCircle className="animate-spin" /> : <PackagePlus />}{pending ? "Saving..." : "Save Draft"}</Button></div><p className="mt-2 text-xs text-slate-500">Save Draft does not add stock. Review the saved draft, then choose Post Purchase to Stock.</p></div>
  </form>;
}
