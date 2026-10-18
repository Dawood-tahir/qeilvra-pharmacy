"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { LoaderCircle, RotateCcw, X } from "lucide-react";
import { requestReturnAction } from "@/app/(app)/returns/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Item = { id: string; medicine_name: string; quantity: number; unit_label?: string };

export function ReturnRequest({ saleId, items }: { saleId: string; items: Item[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const submit = () => startTransition(async () => {
    const selected = items.filter((item) => (quantities[item.id] ?? 0) > 0).map((item) => ({ sale_item_id: item.id, quantity: quantities[item.id] }));
    const result = await requestReturnAction({ saleId, reason, items: selected });
    if (!result.ok) { toast.error(result.error); return; }
    toast.success("Return request sent to the Owner."); setOpen(false);
  });
  return <><Button variant="outline" onClick={() => setOpen(true)}><RotateCcw /> Request return</Button>{open && <div className="fixed inset-0 z-[80] grid place-items-end bg-slate-950/45 sm:place-items-center sm:p-4"><div className="w-full max-h-[92vh] overflow-y-auto rounded-t-3xl bg-white p-5 sm:max-w-lg sm:rounded-3xl sm:p-6"><div className="flex justify-between"><div><p className="text-xs font-bold text-blue-700">Controlled return</p><h2 className="text-xl font-extrabold">Request a refund</h2></div><Button size="icon" variant="ghost" onClick={() => setOpen(false)}><X /></Button></div><p className="mt-2 text-sm leading-6 text-slate-500">The Owner must review and approve this request. Historical sale records will not be changed.</p><div className="mt-4 space-y-2">{items.map((item) => <label key={item.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><span><span className="block text-sm font-bold">{item.medicine_name}</span><span className="text-xs text-slate-500">Sold: {item.quantity} {item.unit_label}</span></span><Input className="w-24 text-right" type="number" min="0" max={item.quantity} step="1" inputMode="numeric" value={quantities[item.id] ?? 0} onChange={(e) => setQuantities((current) => ({ ...current, [item.id]: Number(e.target.value) }))} /></label>)}</div><label className="mt-4 block"><span className="mb-1.5 block text-sm font-semibold">Reason *</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-24 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder="Why is this medicine being returned?" /></label><Button className="mt-5 w-full" size="lg" onClick={submit} disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <RotateCcw />} Submit request</Button></div></div>}</>;
}
