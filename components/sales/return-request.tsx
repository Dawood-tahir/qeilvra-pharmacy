"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { LoaderCircle, RotateCcw, X } from "lucide-react";
import { requestReturnAction } from "@/app/(app)/returns/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { pluralUnit } from "@/lib/medicine-units";

type Item = { id: string; medicine_name: string; quantity: number; unit_label?: string };

export function ReturnRequest({ saleId, invoiceNumber, items }: { saleId: string; invoiceNumber?: string; items: Item[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const busy = useRef(false);
  const submit = () => {
    if (busy.current || uncertain) return;
    const selected = items.filter((item) => (quantities[item.id] ?? 0) > 0).map((item) => ({ sale_item_id: item.id, quantity: quantities[item.id] }));
    if (!selected.length) { setError("Enter a return quantity for at least one medicine."); return; }
    busy.current = true; setError("");
    startTransition(async () => {
      try {
        const result = await requestReturnAction({ saleId, reason, items: selected });
        if (!result.ok) { setError(result.error); setUncertain(Boolean(result.uncertain)); return; }
        toast.success("Return request sent to the Owner. View its status in Returns.");
        setOpen(false); setQuantities({}); setReason("");
      } catch { setUncertain(true); setError("Could not confirm the request. Check Returns before sending it again."); }
      finally { busy.current = false; }
    });
  };
  return <><Button variant="outline" onClick={() => setOpen(true)}><RotateCcw /> Request return</Button>{open && <Dialog label="Request a return" busy={pending} onClose={() => setOpen(false)}>
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-extrabold">Request a return</h2>{invoiceNumber && <p className="mt-1 text-sm font-semibold text-blue-700">Invoice {invoiceNumber}</p>}</div><Button size="icon" variant="ghost" disabled={pending} aria-label="Close return request" onClick={() => setOpen(false)}><X /></Button></div>
    <p className="mt-3 text-sm text-slate-600">Enter the quantity being returned in the original selling unit. The Owner reviews the request before a refund is recorded.</p>
    <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="mt-4 space-y-4">
      <fieldset disabled={pending || uncertain} className="space-y-3">
        {items.map((item) => <label key={item.id} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3 rounded-xl border p-3"><span className="min-w-0"><span className="block break-words text-sm font-bold">{item.medicine_name}</span><span className="block text-xs text-slate-500">Sold: {pluralUnit(item.unit_label ?? "unit", item.quantity)}</span><span className="mt-1 block text-xs font-semibold">Quantity to return</span></span><Input aria-label={"Return quantity for " + item.medicine_name + " " + (item.unit_label ?? "unit")} type="number" min="0" max={item.quantity} step="1" inputMode="numeric" value={quantities[item.id] ?? ""} placeholder="0" onChange={(e) => setQuantities((current) => ({ ...current, [item.id]: Number(e.target.value) }))} /></label>)}
        <label className="block"><span className="mb-2 block text-sm font-semibold">Reason for return *</span><textarea required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-24 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder="Why is this medicine being returned?" /></label>
      </fieldset>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}{uncertain && <Link href="/returns" className="mt-2 block font-bold underline">View return requests</Link>}</p>}
      <Button className="w-full" size="lg" disabled={pending || uncertain}>{pending ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}{pending ? "Sending request..." : "Send Return Request"}</Button>
    </form>
  </Dialog>}</>;
}
