"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { completeReturnAction } from "@/app/(app)/returns/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completeReturnSchema, returnStorageKey, type CompleteReturnInput, type ReturnSale } from "@/lib/instant-return";
import { refundMinor } from "@/lib/sale-pricing";
import { pluralUnit } from "@/lib/medicine-units";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export function CompleteReturn({ invoice, staffId, initialRequest, onBusy, onLocked, onCompleted }: {
  invoice: ReturnSale; staffId: string; initialRequest?: CompleteReturnInput;
  onBusy: (value: boolean) => void; onLocked: (value: boolean) => void;
  onCompleted: (result: { returnNumber: string; refund: number }) => void;
}) {
  const [values, setValues] = useState<Record<string, { quantity: number; restockable: boolean; in_base_units?: boolean }>>(() => Object.fromEntries(initialRequest?.items.map((item) => [item.sale_item_id, item]) ?? []));
  const [reason, setReason] = useState(initialRequest?.reason ?? "");
  const [method, setMethod] = useState<"cash" | "card">(initialRequest?.paymentMethod ?? "cash");
  const [cardConfirmed, setCardConfirmed] = useState(initialRequest?.cardConfirmed ?? false);
  const [uncertain, setUncertain] = useState(Boolean(initialRequest));
  const [error, setError] = useState(initialRequest ? "An unconfirmed return was restored. Retry to check its outcome." : "");
  const [pending, startTransition] = useTransition();
  const request = useRef<CompleteReturnInput | null>(initialRequest ?? null);
  const busy = useRef(false);
  const eligible = (item: ReturnSale["sale_items"][number]) => values[item.id]?.in_base_units ? item.available_base_quantity ?? item.available * item.base_units_per_sale_unit : Math.floor((item.available_base_quantity ?? item.available * item.base_units_per_sale_unit) / item.base_units_per_sale_unit);
  const estimate = invoice.sale_items.reduce((sum, item) => sum + refundMinor(item.net_line_total, item.quantity * item.base_units_per_sale_unit, item.approved_base_quantity ?? item.approved * item.base_units_per_sale_unit, Math.max(0, Math.min(values[item.id]?.quantity ?? 0, eligible(item))) * (values[item.id]?.in_base_units ? 1 : item.base_units_per_sale_unit)), 0) / 100;
  function submit() {
    if (busy.current) return;
    let payload = request.current;
    if (!payload) {
      const selected = invoice.sale_items.filter((item) => (values[item.id]?.quantity ?? 0) > 0);
      if (selected.some((item) => values[item.id].quantity > eligible(item))) { setError("Return quantities exceed the eligible original units."); return; }
      const parsed = completeReturnSchema.safeParse({ saleId: invoice.id, idempotencyKey: crypto.randomUUID(), reason, paymentMethod: method, cardConfirmed, items: selected.map((item) => ({ sale_item_id: item.id, ...values[item.id] })) });
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the return details."); return; }
      payload = parsed.data;
    }
    try {
      const saved = JSON.stringify({ input: payload, invoice });
      sessionStorage.setItem(returnStorageKey(staffId), saved);
      if (sessionStorage.getItem(returnStorageKey(staffId)) !== saved) throw new Error();
    } catch { setError("Browser storage is required to safely retry a refund. Enable storage and try again."); return; }
    request.current = payload; busy.current = true; onBusy(true); onLocked(true); setError("");
    const submitted = payload;
    startTransition(async () => {
      try {
        const result = await completeReturnAction(submitted);
        if (!result.ok) {
          setError(result.error); setUncertain(Boolean(result.uncertain)); onLocked(Boolean(result.uncertain));
          if (!result.uncertain) { request.current = null; try { sessionStorage.removeItem(returnStorageKey(staffId)); } catch {} }
          return;
        }
        try { sessionStorage.removeItem(returnStorageKey(staffId)); } catch { /* A retained key remains safe to retry. */ }
        onCompleted({ returnNumber: result.returnNumber, refund: result.refund });
      } catch { setUncertain(true); setError("The return could not be confirmed. Retry this same return to check its status."); }
      finally { busy.current = false; onBusy(false); }
    });
  }
  return <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="space-y-4">
    <div className="rounded-xl bg-blue-50 p-3"><h3 className="break-all font-extrabold">{invoice.invoice_number}</h3><p className="mt-1 text-xs text-slate-600">{formatDateTime(invoice.completed_at)} · Cashier: {invoice.cashier}</p></div>
    <p className="text-sm text-slate-600">Choose the original selling unit or individual tablets. Extra charges are retained and are not included in medicine refunds. Mark stock suitable for resale only after checking the returned medicine.</p>
    <fieldset disabled={pending || uncertain} className="min-w-0 space-y-3">
      {invoice.sale_items.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-3"><label className="block"><span className="block break-words text-sm font-bold">{item.medicine_name}</span><span className="mt-1 block text-xs text-slate-500">Sold: {pluralUnit(item.unit_label, item.quantity)} · Eligible: {pluralUnit(item.unit_label, item.available)}</span><span className="block text-xs text-slate-500">Original price: {formatCurrency(item.unit_price)} / {item.unit_label}</span>{item.base_units_per_sale_unit > 1 && <span className="mt-2 block text-xs font-semibold">Return unit<select aria-label={"Return unit for " + item.medicine_name + " " + item.unit_label} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2" value={values[item.id]?.in_base_units ? "base" : "original"} onChange={event => setValues(current => ({ ...current, [item.id]: { quantity: 0, restockable: current[item.id]?.restockable ?? false, in_base_units: event.target.value === "base" } }))}><option value="original">{item.unit_label}</option><option value="base">Individual {item.base_unit}</option></select></span>}<span className="mt-2 block text-xs font-semibold">Quantity to return ({values[item.id]?.in_base_units ? item.base_unit : item.unit_label})</span><Input aria-label={`Return quantity for ${item.medicine_name} ${item.unit_label}`} className="mt-1 max-w-32" type="number" min="0" max={eligible(item)} step="1" inputMode="numeric" placeholder="0" disabled={eligible(item) <= 0} value={values[item.id]?.quantity ?? ""} onChange={(event) => setValues((current) => ({ ...current, [item.id]: { ...current[item.id], quantity: Number(event.target.value), restockable: current[item.id]?.restockable ?? false } }))} /></label><label className="mt-2 flex min-h-11 items-center gap-2 text-sm"><input className="size-5 shrink-0 accent-emerald-600" type="checkbox" disabled={item.available <= 0} checked={values[item.id]?.restockable ?? false} onChange={(event) => setValues((current) => ({ ...current, [item.id]: { ...current[item.id], quantity: current[item.id]?.quantity ?? 0, restockable: event.target.checked } }))} /> Suitable for resale — add back to stock</label></div>)}
      <label className="block text-sm font-semibold">Reason for return *<textarea required minLength={3} maxLength={500} className="mt-2 min-h-20 w-full rounded-xl border border-slate-200 p-3 font-normal" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <label className="block text-sm font-semibold">Refund method<select className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal" value={method} onChange={(event) => { setMethod(event.target.value as "cash" | "card"); setCardConfirmed(false); }}><option value="cash">Cash</option><option value="card">Card (manual)</option></select></label>
      {method === "card" && <label className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm"><input type="checkbox" required className="mt-0.5 size-5 shrink-0" checked={cardConfirmed} onChange={(event) => setCardConfirmed(event.target.checked)} /> I have completed the refund on the external card terminal. Qeilvra records it and does not refund the card automatically.</label>}
    </fieldset>
    <p className="flex justify-between gap-3 rounded-xl bg-blue-50 p-3 font-extrabold"><span>Refund amount</span><span>{formatCurrency(estimate)}</span></p><p className="text-xs text-slate-500">Uses the original charged prices and discounts. The saved refund is calculated securely when completing the return.</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}{uncertain && <Link href="/returns" className="mt-2 block font-bold underline">Check return history</Link>}</p>}
    <Button className="w-full" size="lg" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}{pending ? "Completing return..." : uncertain ? "Retry Return" : "Complete Return"}</Button>
  </form>;
}
