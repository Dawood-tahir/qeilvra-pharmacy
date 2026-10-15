"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LoaderCircle, PackagePlus, Plus, Search, Trash2 } from "lucide-react";
import { createPurchaseAction } from "@/app/(app)/purchases/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, localDateISO } from "@/lib/utils";

type Supplier = { id: string; name: string };
type Medicine = { id: string; name: string; strength?: string; sku: string };
type PurchaseItem = Medicine & { rowId: string; batch_number: string; expiry_date: string; quantity: number; unit_cost: number };

export function PurchaseForm({ suppliers }: { suppliers: Supplier[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Medicine[]>([]);
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(localDateISO());
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const subtotal = useMemo(() => items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0), [items]);

  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(async () => { if (query.trim().length < 2) { setResults([]); return; } const response = await fetch(`/api/medicines/search?q=${encodeURIComponent(query)}&limit=8`, { signal: controller.signal }); if (response.ok) setResults(await response.json()); }, 220); return () => { clearTimeout(timer); controller.abort(); }; }, [query]);
  const add = (medicine: Medicine) => { setItems((current) => [...current, { ...medicine, rowId: crypto.randomUUID(), batch_number: "", expiry_date: "", quantity: 1, unit_cost: 0 }]); setQuery(""); setResults([]); };
  const update = (rowId: string, patch: Partial<PurchaseItem>) => setItems((current) => current.map((item) => item.rowId === rowId ? { ...item, ...patch } : item));
  const submit = () => startTransition(async () => {
    const result = await createPurchaseAction({ supplier_id: supplierId, supplier_invoice_number: invoiceNumber, invoice_date: invoiceDate, discount, notes, items: items.map(({ id, batch_number, expiry_date, quantity, unit_cost }) => ({ medicine_id: id, batch_number, expiry_date, quantity, unit_cost })) });
    if (!result.ok) { toast.error(result.error); return; }
    toast.success("Purchase draft created. Review it before posting stock."); router.push(`/purchases/${result.id}`); router.refresh();
  });
  return <div className="space-y-6"><div className="grid gap-4 sm:grid-cols-2"><label><span className="mb-1.5 block text-sm font-semibold">Supplier *</span><select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm" required><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label><span className="mb-1.5 block text-sm font-semibold">Supplier invoice #</span><Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /></label><label><span className="mb-1.5 block text-sm font-semibold">Invoice date *</span><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></label><label><span className="mb-1.5 block text-sm font-semibold">Discount (Rs.)</span><Input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} /></label></div><div><h2 className="font-bold">Purchase items</h2><div className="relative mt-3"><Search className="absolute left-3 top-3.5 size-4 text-slate-400" /><Input className="pl-10" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a medicine by name or SKU" />{results.length > 0 && <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border bg-white shadow-xl">{results.map((medicine) => <button key={medicine.id} onClick={() => add(medicine)} className="flex w-full items-center justify-between p-3 text-left hover:bg-blue-50"><span><span className="block text-sm font-bold">{medicine.name} {medicine.strength}</span><span className="text-xs text-slate-500">{medicine.sku}</span></span><Plus className="size-4 text-blue-600" /></button>)}</div>}</div><div className="mt-3 space-y-3">{items.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Search and add at least one medicine.</div>}{items.map((item) => <div key={item.rowId} className="rounded-2xl border border-slate-200 p-3"><div className="flex justify-between"><div><p className="text-sm font-bold">{item.name} {item.strength}</p><p className="text-xs text-slate-500">{item.sku}</p></div><button onClick={() => setItems((current) => current.filter((x) => x.rowId !== item.rowId))} className="text-slate-400 hover:text-red-600"><Trash2 className="size-4" /></button></div><div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4"><label><span className="mb-1 block text-xs font-semibold">Batch #</span><Input value={item.batch_number} onChange={(e) => update(item.rowId, { batch_number: e.target.value })} /></label><label><span className="mb-1 block text-xs font-semibold">Expiry</span><Input type="date" value={item.expiry_date} onChange={(e) => update(item.rowId, { expiry_date: e.target.value })} /></label><label><span className="mb-1 block text-xs font-semibold">Quantity</span><Input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(e) => update(item.rowId, { quantity: Number(e.target.value) })} /></label><label><span className="mb-1 block text-xs font-semibold">Unit cost (Rs.)</span><Input type="number" min="0" step="0.01" value={item.unit_cost} onChange={(e) => update(item.rowId, { unit_cost: Number(e.target.value) })} /></label></div><p className="mt-2 text-right text-sm font-bold">Line total: {formatCurrency(item.quantity * item.unit_cost)}</p></div>)}</div></div><label className="block"><span className="mb-1.5 block text-sm font-semibold">Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm" /></label><div className="flex items-center justify-between border-t pt-5"><div><p className="text-xs text-slate-500">Draft total</p><p className="text-2xl font-extrabold">{formatCurrency(Math.max(subtotal - discount, 0))}</p></div><Button size="lg" onClick={submit} disabled={pending || !supplierId || !items.length}>{pending ? <LoaderCircle className="animate-spin" /> : <PackagePlus />} Save draft</Button></div><p className="text-xs text-slate-500">Saving a draft does not change stock. Stock increases only after the Owner posts the purchase.</p></div>;
}
