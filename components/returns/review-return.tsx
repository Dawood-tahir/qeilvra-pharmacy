"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, LoaderCircle, RotateCcw, X } from "lucide-react";
import { reviewReturnAction } from "@/app/(app)/returns/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";

type Item = { id: string; quantity: number; medicine: string };

export function ReviewReturn({ returnId, invoiceNumber, items, onReviewed }: { returnId: string; invoiceNumber?: string; items: Item[]; onReviewed?: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState(() => Object.fromEntries(items.map((item) => [item.id, { quantity: item.quantity, restockable: false }])));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const busy = useRef(false);
  const review = (approve: boolean) => {
    if (busy.current) return;
    busy.current = true; setError("");
    startTransition(async () => {
      try {
        const result = await reviewReturnAction({ returnId, approve, notes, paymentMethod: "cash", items: approve ? items.map((item) => ({ return_item_id: item.id, approved_quantity: values[item.id]?.quantity ?? 0, restockable: values[item.id]?.restockable ?? false })) : [] });
        if (!result.ok) { setError(result.error); return; }
        toast.success(approve ? "Return approved. Cash refund recorded: " + formatCurrency(result.refund) : "Return rejected."); setOpen(false); onReviewed?.();
      } catch { setError("Could not confirm the decision. Check Returns for its current status before trying again."); }
      finally { busy.current = false; }
    });
  };
  return <><Button size="sm" onClick={() => setOpen(true)}><RotateCcw /> Review</Button>{open && <Dialog label="Review return" busy={pending} onClose={() => setOpen(false)}>
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-extrabold">Review return</h2>{invoiceNumber && <p className="mt-1 text-sm font-semibold text-blue-700">Invoice {invoiceNumber}</p>}</div><Button size="icon" variant="ghost" disabled={pending} aria-label="Close return review" onClick={() => setOpen(false)}><X /></Button></div>
    <p className="mt-3 text-sm text-slate-600">Check the returned quantities. Select Add back to stock only for medicine suitable for resale under your pharmacy policy.</p>
    <form onSubmit={(event) => { event.preventDefault(); review(true); }} className="mt-4 space-y-4">
      <fieldset disabled={pending} className="space-y-3">
        {items.map((item) => <div key={item.id} className="rounded-xl border p-3"><p className="break-words text-sm font-bold">{item.medicine}</p><p className="mt-1 text-xs text-slate-500">Requested quantity: {item.quantity}</p><div className="mt-3 grid grid-cols-[5rem_minmax(0,1fr)] items-end gap-3"><label className="text-xs font-semibold">Approve quantity<Input aria-label={"Approved quantity for " + item.medicine} className="mt-1" required type="number" min="0" max={item.quantity} step="1" inputMode="numeric" value={values[item.id]?.quantity ?? 0} onChange={(e) => setValues((current) => ({ ...current, [item.id]: { ...current[item.id], quantity: Number(e.target.value) } }))} /></label><label className="flex min-h-11 items-center gap-2 rounded-xl bg-emerald-50 p-2 text-sm font-semibold text-emerald-800"><input aria-label={"Add " + item.medicine + " back to stock"} type="checkbox" checked={values[item.id]?.restockable ?? false} onChange={(e) => setValues((current) => ({ ...current, [item.id]: { ...current[item.id], restockable: e.target.checked } }))} className="size-5 shrink-0 accent-emerald-600" /> Add back to stock</label></div></div>)}
        <label className="block"><span className="mb-2 block text-sm font-semibold">Review notes (optional)</span><textarea maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm" /></label>
      </fieldset>
      <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">Approval records a cash refund. Only quantities marked Add back to stock return to available stock.</p>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="text-red-600" onClick={() => review(false)} disabled={pending}><X /> Reject</Button><Button className="min-w-0 flex-1" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <Check />}{pending ? "Saving..." : "Approve Refund"}</Button></div>
    </form>
  </Dialog>}</>;
}
