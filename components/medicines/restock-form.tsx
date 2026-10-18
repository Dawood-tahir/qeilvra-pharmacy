"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, LoaderCircle, Search } from "lucide-react";
import { receiveStockAction } from "@/app/(app)/medicines/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/medicines/medicine-form";
import { SupplierSelect, type SupplierOption } from "@/components/purchases/supplier-select";
import { cn, formatCurrency, formatDate, localDateISO } from "@/lib/utils";
import { pluralUnit, stockQuantity, type StockMedicine } from "@/lib/medicine-units";
import { receiveStockSchema } from "@/lib/guided-medicine";

const emptyStock = { unit_key: "base", quantity: "", batch_number: "", expiry_date: "", total_cost: "", supplier_id: "" };
export function RestockForm({ initialMedicine = null, suppliers = [] }: { initialMedicine?: StockMedicine | null; suppliers?: SupplierOption[] }) {
  const [medicine, setMedicine] = useState(initialMedicine);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockMedicine[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchVersion, setSearchVersion] = useState(0);
  const [error, setError] = useState("");
  const [stock, setStock] = useState(emptyStock);
  const [review, setReview] = useState(false);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<number | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const key = useRef(crypto.randomUUID());
  const busy = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const supplier = suppliers.find((s) => s.id === stock.supplier_id);
  const focusHeading = () => requestAnimationFrame(() => heading.current?.focus());
  useEffect(() => {
    if (medicine) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/medicines/search?q=" + encodeURIComponent(query) + "&limit=10", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error();
        setResults(await response.json()); setError("");
      } catch { if (!controller.signal.aborted) setError("Could not find medicines. Check your connection and try again."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, medicine, searchVersion]);
  const unit = medicine?.units.find((u) => u.unit_key === stock.unit_key);
  const total = stockQuantity(Number(stock.quantity), unit?.base_quantity ?? 0);
  function submit() {
    if (!medicine || busy.current) return;
    const parsed = receiveStockSchema.safeParse({ ...stock, quantity: Number(stock.quantity) });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (!total) { setError("Enter a whole quantity and choose the purchased unit."); return; }
    if (!review) { setError(""); setReview(true); focusHeading(); return; }
    busy.current = true;
    startTransition(async () => {
      try {
        const result = await receiveStockAction(medicine.id, parsed.data, key.current);
        if (!result.ok) { setError(result.error); setUncertain(Boolean(result.uncertain)); return; }
        setError(""); setSaved(result.quantity); setUncertain(false); focusHeading();
      } catch { setUncertain(true); setError("Could not confirm the save. Retry the same stock receipt to check its status."); }
      finally { busy.current = false; }
    });
  }
  if (saved !== null && medicine) return <section className="py-6 text-center"><CheckCircle2 className="mx-auto size-14 text-emerald-600" /><h2 ref={heading} tabIndex={-1} className="mt-4 text-xl font-extrabold">Stock added successfully.</h2><p className="mt-2">{pluralUnit(medicine.base_unit, saved)} added to {medicine.name}.</p>{supplier && <p className="mt-2 text-sm text-slate-600">Purchased from {supplier.name}.</p>}<p className="mt-2 text-sm text-slate-500">This delivery is recorded in Purchases.</p><div className="mt-6 flex flex-col gap-3"><Button onClick={() => { setSaved(null); setMedicine(null); setStock(emptyStock); setQuery(""); setReview(false); setError(""); key.current = crypto.randomUUID(); }}>Add More Stock</Button><Link href={"/medicines/" + medicine.id} className={buttonVariants({ variant: "outline" })}>View Medicine</Link><Link href="/medicines" className={buttonVariants({ variant: "ghost" })}>Done</Link></div></section>;
  return <div className="space-y-5">
    <ol aria-label="Stock receiving steps" className="grid grid-cols-3 gap-2 text-center text-xs font-bold">{["Medicine", "Supplier & stock", "Review"].map((label, i) => <li key={label} aria-current={(!medicine ? 0 : review ? 2 : 1) === i ? "step" : undefined} className={cn("rounded-xl px-2 py-3", (!medicine ? 0 : review ? 2 : 1) === i ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500")}>{i + 1}. {label}</li>)}</ol>
    {!medicine ? <><Field label="Search or scan an existing medicine"><div className="relative"><Search className="absolute left-3 top-3.5 size-5 text-slate-400" /><Input className="h-12 pl-11" autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setResults([]); setLoading(true); setError(""); }} placeholder="Name, generic name or barcode" /></div></Field>{loading && <p role="status" className="text-sm text-slate-500">Finding medicines...</p>}<div className="space-y-2">{results.map((m) => <button key={m.id} className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-left hover:bg-blue-50" onClick={() => { setMedicine(m); setStock(emptyStock); setError(""); focusHeading(); }}><span><strong>{m.name} {m.strength}</strong><span className="mt-1 block text-xs text-slate-500">{m.manufacturer || m.sku}</span></span><span className="text-xs text-slate-600">{pluralUnit(m.base_unit, m.available_quantity)}</span></button>)}</div>{!loading && !results.length && !error && <p className="text-sm text-slate-500">No medicines found. Use <Link className="font-semibold text-blue-700 underline" href="/medicines/new">Add New Medicine</Link> for a medicine you have never entered.</p>}</> : <>
      <div className="rounded-xl bg-blue-50 p-4"><h2 ref={heading} tabIndex={-1} className="font-extrabold">{review ? "Review stock: " : ""}{medicine.name} {medicine.strength}</h2><p className="mt-1 text-sm">Current available stock: {pluralUnit(medicine.base_unit, medicine.available_quantity)}</p>{!review && <button disabled={pending} className="mt-1 min-h-11 text-sm font-bold text-blue-700" onClick={() => { setMedicine(null); setReview(false); }}>Choose another medicine</button>}</div>
      {medicine.is_active === false || medicine.packaging_status !== "confirmed" ? <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Check that this medicine is active and confirm its stock unit and packaging first. <Link className="font-bold underline" href={"/medicines/" + medicine.id + "/edit"}>Review packaging</Link></p> : <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
        {!review ? <fieldset disabled={pending} className="space-y-4">
          <SupplierSelect suppliers={suppliers} value={stock.supplier_id} onChange={(supplier_id) => setStock({ ...stock, supplier_id })} label="Purchased From (Supplier)" />
          <fieldset><legend className="mb-2 text-sm font-semibold">Purchased unit</legend><div className="flex flex-wrap gap-2">{medicine.units.map((u) => <button type="button" key={u.unit_key} aria-pressed={stock.unit_key === u.unit_key} onClick={() => setStock({ ...stock, unit_key: u.unit_key })} className={cn("min-h-12 flex-1 rounded-xl border px-3 py-2 font-bold capitalize", stock.unit_key === u.unit_key ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200")}>{u.label}</button>)}</div></fieldset>
          <Field label="How many did you buy?" required><Input required type="number" inputMode="numeric" min="1" step="1" value={stock.quantity} onChange={(e) => setStock({ ...stock, quantity: e.target.value })} /></Field>
          {unit && unit.base_quantity > 1 && <p className="text-sm text-slate-500">1 {unit.label} = {pluralUnit(medicine.base_unit, unit.base_quantity)}</p>}
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Batch number" required><Input required maxLength={80} value={stock.batch_number} onChange={(e) => setStock({ ...stock, batch_number: e.target.value })} /></Field><Field label="Expiry date" required><Input required type="date" min={localDateISO()} value={stock.expiry_date} onChange={(e) => setStock({ ...stock, expiry_date: e.target.value })} /></Field></div>
          <Field label="Total purchase cost (Rs.)" required><Input required inputMode="decimal" placeholder="Cost of all the stock entered above" value={stock.total_cost} onChange={(e) => setStock({ ...stock, total_cost: e.target.value })} /></Field>
        </fieldset> : <section aria-label="Stock receipt review" className="rounded-xl border border-slate-200 p-4"><dl className="space-y-3 text-sm">{[
          ["Supplier", supplier?.name ?? "Supplier not recorded"],
          ["Received quantity", pluralUnit(unit?.label ?? medicine.base_unit, Number(stock.quantity)) + " (" + pluralUnit(medicine.base_unit, total) + ")"],
          ["Batch", stock.batch_number], ["Expiry", formatDate(stock.expiry_date)], ["Purchase cost", formatCurrency(stock.total_cost)],
          ["Previous available stock", pluralUnit(medicine.base_unit, medicine.available_quantity)],
        ].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-slate-500">{label}</dt><dd className="break-words font-semibold">{value}</dd></div>)}</dl></section>}
        <div aria-live="polite" className="rounded-xl bg-blue-50 p-4"><p className="text-sm">New stock: {pluralUnit(medicine.base_unit, total)}</p><p className="mt-1 text-lg font-extrabold text-blue-800">Stock after adding: {pluralUnit(medicine.base_unit, medicine.available_quantity + total)}</p><p className="mt-2 text-xs text-slate-600">Saving also records this delivery in Purchases. Enter each delivery only once.</p></div>
        {!review && <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold">Current selling prices</summary>{medicine.units.map((u) => <p key={u.unit_key} className="mt-2 text-sm">1 {u.label}: {formatCurrency(u.selling_price)}</p>)}<Link href={"/medicines/" + medicine.id + "/edit"} className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-blue-700">Edit selling prices</Link></details>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 flex gap-3 border-t bg-white/95 py-3 lg:bottom-0">{review && !uncertain && <Button type="button" variant="outline" disabled={pending} onClick={() => { setReview(false); setError(""); focusHeading(); }}>Back</Button>}<Button className="flex-1" size="lg" disabled={pending}>{pending && <LoaderCircle className="animate-spin" />}{pending ? "Saving stock..." : uncertain ? "Retry Stock Save" : review ? "Add to Stock" : "Review Stock"}</Button></div>
      </form>}
    </>}
    {!medicine && error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}<Button variant="ghost" onClick={() => setSearchVersion((n) => n + 1)}>Try again</Button></div>}
  </div>;
}
