"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, LoaderCircle, RotateCcw, X } from "lucide-react";
import { reviewReturnAction } from "@/app/(app)/returns/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Item = { id: string; quantity: number; medicine: string };

export function ReviewReturn({ returnId, items }: { returnId: string; items: Item[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState(() => Object.fromEntries(items.map((item) => [item.id, { quantity: item.quantity, restockable: false }])));
  const [notes, setNotes] = useState("");
  const review = (approve: boolean) => startTransition(async () => {
    const result = await reviewReturnAction({ returnId, approve, notes, paymentMethod: "cash", items: approve ? items.map((item) => ({ return_item_id: item.id, approved_quantity: values[item.id]?.quantity ?? 0, restockable: values[item.id]?.restockable ?? false })) : [] });
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(approve ? "Return approved and refund recorded." : "Return rejected."); setOpen(false);
  });
  return <><Button size="sm" onClick={() => setOpen(true)}><RotateCcw /> Review</Button>{open && <div className="fixed inset-0 z-[80] grid place-items-end bg-slate-950/45 sm:place-items-center sm:p-4"><div className="w-full max-h-[92vh] overflow-y-auto rounded-t-3xl bg-white p-5 sm:max-w-xl sm:rounded-3xl sm:p-6"><div className="flex justify-between"><div><p className="text-xs font-bold text-blue-700">Owner authorization</p><h2 className="text-xl font-extrabold">Review return</h2></div><Button size="icon" variant="ghost" onClick={() => setOpen(false)}><X /></Button></div><p className="mt-2 text-sm leading-6 text-slate-500">Confirm quantities and mark only unopened, policy-compliant medicine as suitable for resale.</p><div className="mt-4 space-y-2">{items.map((item) => <div key={item.id} className="rounded-xl border p-3"><p className="text-sm font-bold">{item.medicine}</p><div className="mt-2 flex items-center gap-3"><label className="flex-1 text-xs font-semibold">Approved quantity<Input className="mt-1" type="number" min="0" max={item.quantity} step="0.001" value={values[item.id]?.quantity ?? 0} onChange={(e) => setValues((current) => ({ ...current, [item.id]: { ...current[item.id], quantity: Number(e.target.value) } }))} /></label><label className="mt-5 flex flex-1 items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-800"><input type="checkbox" checked={values[item.id]?.restockable ?? false} onChange={(e) => setValues((current) => ({ ...current, [item.id]: { ...current[item.id], restockable: e.target.checked } }))} className="size-4 accent-emerald-600" /> Suitable for resale</label></div></div>)}</div><label className="mt-4 block"><span className="mb-1.5 block text-sm font-semibold">Review notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm" /></label><div className="mt-5 grid grid-cols-2 gap-3"><Button variant="outline" className="text-red-600" onClick={() => review(false)} disabled={pending}><X /> Reject</Button><Button onClick={() => review(true)} disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <Check />} Approve refund</Button></div><p className="mt-3 text-center text-xs text-slate-500">Approval creates a refund payment and a separate stock movement. The original sale remains unchanged.</p></div></div>}</>;
}
