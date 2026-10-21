"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { AdjustStock } from "./adjust-stock";
import { useStockRequest } from "./use-stock-request";
import { disposeStockAction } from "@/app/(app)/stock/actions";
import { dispositionSchema, batchCostMinor, type DispositionInput } from "@/lib/stock-disposition";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function StockActions({ staffId, batchId, medicine, batch, quantity, unit, cost, supplierId, supplierName, suppliers, expired }: { staffId: string; batchId: string; medicine: string; batch: string; quantity: number; unit: string; cost: number | string; supplierId: string | null; supplierName?: string; suppliers: { id: string; name: string }[]; expired: boolean }) {
  const [open, setOpen] = useState(false); const [kind, setKind] = useState<DispositionInput["kind"]>("discard");
  const [count, setCount] = useState(""); const [reason, setReason] = useState(expired ? "Expired stock" : "");
  const [supplier, setSupplier] = useState(supplierId ?? ""); const [method, setMethod] = useState<DispositionInput["method"]>("credit");
  const [removed, setRemoved] = useState(false);
  const operation = useStockRequest("qeilvra-stock-action-" + staffId + "-" + batchId, dispositionSchema, disposeStockAction, "Stock action recorded. Inventory and reports updated.");
  const locked = operation.pending || Boolean(operation.request) || operation.blocked;
  function show(next: DispositionInput["kind"]) {
    const saved = operation.restore(); setKind(saved?.kind ?? next);
    if (saved) { setCount(String(saved.quantity)); setReason(saved.reason); setSupplier(saved.supplierId ?? ""); setMethod(saved.method); setRemoved(true); }
    else setRemoved(false);
    setOpen(true);
  }
  const title = kind === "discard" ? "Discard Stock" : "Return to Supplier";
  const costMinor = batchCostMinor(cost, Number(count));
  return <><div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" className="text-red-700" disabled={quantity <= 0 && !operation.request} onClick={() => show("discard")}>Discard Stock</Button><Button size="sm" variant="outline" disabled={quantity <= 0 && !operation.request} onClick={() => show("supplier_return")}>Return to Supplier</Button><AdjustStock batchId={batchId} medicine={medicine} batch={batch} quantity={quantity} unit={unit} /></div>{open && <Dialog label={title} busy={operation.pending} onClose={() => setOpen(false)}><div className="flex justify-between gap-3"><div><h2 className="text-xl font-extrabold">{title}</h2><p className="mt-2 font-bold">{medicine}</p><p className="mt-1 text-xs text-slate-500">Batch {batch} · Available: {quantity} {unit}s</p></div><Button variant="ghost" size="icon" aria-label="Close stock action" disabled={operation.pending} onClick={() => setOpen(false)}><X /></Button></div><form className="mt-4 space-y-4" onSubmit={async event => { event.preventDefault(); const input = { key: crypto.randomUUID(), batchId, kind, quantity: Number(count), expectedQuantity: quantity, reason, supplierId: kind === "supplier_return" ? supplier || null : supplierId, method, removed }; if (await operation.execute(input)) setOpen(false); }}><fieldset className="space-y-4" disabled={locked}>
    {kind === "supplier_return" && <><label className="block text-sm font-semibold">Supplier{supplierId ? <p className="mt-1 rounded-xl bg-slate-50 p-3 font-normal">{supplierName || "Recorded supplier"} · from this batch’s purchase</p> : <select aria-label="Supplier accepting return" value={supplier} onChange={event => setSupplier(event.target.value)} required className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3"><option value="">Select supplier</option>{suppliers.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>}</label><label className="block text-sm font-semibold">Expected supplier settlement<select aria-label="Expected supplier settlement" className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3" value={method} onChange={event => setMethod(event.target.value as DispositionInput["method"])}><option value="credit">Supplier credit</option><option value="refund">Refund</option><option value="replacement">Replacement stock</option></select></label></>}
    <label className="block text-sm font-semibold">Quantity ({unit}s)<Input className="mt-2" type="number" min="1" max={quantity} step="1" inputMode="numeric" required value={count} onChange={event => setCount(event.target.value)} autoFocus /></label><label className="block text-sm font-semibold">Reason<textarea aria-label="Reason" required minLength={3} maxLength={500} className="mt-2 min-h-20 w-full rounded-xl border border-slate-200 p-3 font-normal" value={reason} onChange={event => setReason(event.target.value)} /></label>
    <p className="rounded-xl bg-amber-50 p-3 text-sm">Recorded batch cost: <strong>{formatCurrency(costMinor == null ? null : costMinor / 100)}</strong>{kind === "supplier_return" && <span className="mt-1 block">Pending supplier recovery is not received money. Confirm it separately after the supplier settles.</span>}</p><label className="flex items-start gap-2 text-sm"><input className="mt-0.5 size-5 shrink-0" type="checkbox" required checked={removed} onChange={event => setRemoved(event.target.checked)} />{kind === "discard" ? "I confirm this stock is physically discarded." : "I confirm this stock has been removed or segregated and is unavailable for sale."}</label></fieldset>
    {operation.error && <p role="alert" className="text-sm text-red-700">{operation.error}</p>}<Button className="w-full" disabled={operation.pending || operation.blocked}>{operation.pending ? "Saving…" : operation.request ? "Retry Stock Action" : "Confirm " + title}</Button></form></Dialog>}</>;
}
