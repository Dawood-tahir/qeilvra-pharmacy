"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { LoaderCircle, SlidersHorizontal, X } from "lucide-react";
import { adjustStockAction } from "@/app/(app)/stock/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AdjustStock({ batchId, medicine, batch, quantity }: { batchId: string; medicine: string; batch: string; quantity: number }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const submit = (formData: FormData) => startTransition(async () => {
    const result = await adjustStockAction({ batchId, quantityDelta: formData.get("quantityDelta"), reason: formData.get("reason") });
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(`Stock adjusted. New quantity: ${result.quantity}`); setOpen(false);
  });
  return <><Button variant="ghost" size="sm" onClick={() => setOpen(true)}><SlidersHorizontal /> Adjust</Button>{open && <div className="fixed inset-0 z-[80] grid place-items-end bg-slate-950/45 p-0 sm:place-items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !pending) setOpen(false); }}><div className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-3xl sm:p-6"><div className="flex justify-between"><div><p className="text-xs font-bold text-blue-700">Stock correction</p><h2 className="mt-1 text-xl font-extrabold">{medicine}</h2><p className="mt-1 text-xs text-slate-500">Batch {batch} · current quantity {quantity}</p></div><Button variant="ghost" size="icon" onClick={() => setOpen(false)}><X /></Button></div><form action={submit} className="mt-5 space-y-4"><label className="block"><span className="mb-1.5 block text-sm font-semibold">Quantity change</span><Input name="quantityDelta" type="number" step="0.001" required autoFocus placeholder="e.g. -2 or 5" /><span className="mt-1 block text-xs text-slate-500">Use a negative number to remove stock.</span></label><label className="block"><span className="mb-1.5 block text-sm font-semibold">Reason *</span><textarea name="reason" required minLength={3} maxLength={500} className="min-h-24 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder="Explain the physical count difference" /></label><Button className="w-full" size="lg" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <SlidersHorizontal />} Record adjustment</Button><p className="text-center text-xs text-slate-500">This action is permanent and recorded in the audit log.</p></form></div></div>}</>;
}
