"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, LoaderCircle, Search } from "lucide-react";
import { receiveStockAction } from "@/app/(app)/medicines/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/medicines/medicine-form";
import { cn, formatCurrency, localDateISO } from "@/lib/utils";
import { pluralUnit, stockQuantity, type StockMedicine } from "@/lib/medicine-units";
import { receiveStockSchema } from "@/lib/guided-medicine";

export function RestockForm({ initialMedicine = null }: { initialMedicine?: StockMedicine | null }) {
  const [medicine, setMedicine] = useState(initialMedicine);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockMedicine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stock, setStock] = useState({ unit_key: "base", quantity: "", batch_number: "", expiry_date: "", total_cost: "" });
  const [review, setReview] = useState(false);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<number | null>(null);
  const key = useRef(crypto.randomUUID());
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
  }, [query, medicine]);
  const unit = medicine?.units.find((u) => u.unit_key === stock.unit_key);
  const total = stockQuantity(Number(stock.quantity), unit?.base_quantity ?? 0);
  function submit() {
    if (!medicine) return;
    const parsed = receiveStockSchema.safeParse({ ...stock, quantity: Number(stock.quantity) });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (!total) { setError("Enter a whole quantity and choose the purchased unit."); return; }
    if (!review) { setError(""); setReview(true); return; }
    startTransition(async () => {
      try {
        const result = await receiveStockAction(medicine.id, parsed.data, key.current);
        if (!result.ok) { setError(result.error); return; }
        setSaved(result.quantity);
      } catch { setError("Could not confirm the save. Your entries are kept; try again."); }
    });
  }
  if (saved !== null && medicine) return <section className="py-6 text-center"><CheckCircle2 className="mx-auto size-14 text-emerald-600" /><h2 className="mt-4 text-xl font-extrabold">Stock added successfully.</h2><p className="mt-2">{pluralUnit(medicine.base_unit, saved)} added to {medicine.name}.</p><div className="mt-6 flex flex-col gap-3"><Button onClick={() => { setSaved(null); setMedicine(null); setStock({ unit_key: "base", quantity: "", batch_number: "", expiry_date: "", total_cost: "" }); setReview(false); key.current = crypto.randomUUID(); }}>Add More Stock</Button><Link href={"/medicines/" + medicine.id} className={buttonVariants({ variant: "outline" })}>View Medicine</Link><Link href="/medicines" className={buttonVariants({ variant: "ghost" })}>Done</Link></div></section>;
  return <div className="space-y-5">{!medicine ? <><Field label="Search or scan an existing medicine"><div className="relative"><Search className="absolute left-3 top-3.5 size-5 text-slate-400" /><Input className="h-12 pl-11" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, generic name or barcode" /></div></Field>{loading && <p role="status" className="text-sm text-slate-500">Finding medicines...</p>}<div className="space-y-2">{results.map((m) => <button key={m.id} className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-left hover:bg-blue-50" onClick={() => { setMedicine(m); setError(""); }}><span><strong>{m.name} {m.strength}</strong><span className="mt-1 block text-xs text-slate-500">{m.manufacturer || m.sku}</span></span><span className="text-xs text-slate-600">{pluralUnit(m.base_unit, m.available_quantity)}</span></button>)}</div>{!loading && !results.length && <p className="text-sm text-slate-500">No medicines found. Use Add New Medicine for a medicine you have never entered.</p>}</> : <><div className="rounded-xl bg-blue-50 p-4"><h2 className="font-extrabold">{medicine.name} {medicine.strength}</h2><p className="mt-1 text-sm">Current available stock: {pluralUnit(medicine.base_unit, medicine.available_quantity)}</p><button className="mt-2 min-h-11 text-sm font-bold text-blue-700" onClick={() => { setMedicine(null); setReview(false); }}>Choose another medicine</button></div>{medicine.is_active === false || medicine.packaging_status !== "confirmed" ? <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Check that this medicine is active and confirm its stock unit and packaging first. <Link className="font-bold underline" href={"/medicines/" + medicine.id + "/edit"}>Review packaging</Link></p> : <form onSubmit={(e) => { e.preventDefault(); if (!pending) submit(); }} className="space-y-4"><fieldset disabled={review || pending} className="space-y-4"><legend className="mb-3 text-sm font-semibold">What did you buy?</legend><div className="flex flex-wrap gap-2">{medicine.units.map((u) => <button type="button" key={u.unit_key} aria-pressed={stock.unit_key === u.unit_key} onClick={() => setStock({ ...stock, unit_key: u.unit_key })} className={cn("min-h-12 flex-1 rounded-xl border px-3 py-2 font-bold capitalize", stock.unit_key === u.unit_key ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200")}>{u.label}</button>)}</div><Field label="How many did you buy?" required><Input type="number" inputMode="numeric" min="1" step="1" value={stock.quantity} onChange={(e) => setStock({ ...stock, quantity: e.target.value })} /></Field>{unit && unit.base_quantity > 1 && <p className="text-sm text-slate-500">1 {unit.label} = {pluralUnit(medicine.base_unit, unit.base_quantity)}</p>}<Field label="Batch number" required><Input required maxLength={80} value={stock.batch_number} onChange={(e) => setStock({ ...stock, batch_number: e.target.value })} /></Field><Field label="Expiry date" required><Input required type="date" min={localDateISO()} value={stock.expiry_date} onChange={(e) => setStock({ ...stock, expiry_date: e.target.value })} /></Field><Field label="Total purchase cost (Rs.)" required><Input required inputMode="decimal" value={stock.total_cost} onChange={(e) => setStock({ ...stock, total_cost: e.target.value })} /></Field></fieldset><div aria-live="polite" className="rounded-xl bg-blue-50 p-4"><p className="text-sm">New stock: {pluralUnit(medicine.base_unit, total)}</p><p className="mt-1 text-lg font-extrabold text-blue-800">Stock after adding: {pluralUnit(medicine.base_unit, medicine.available_quantity + total)}</p>{review && <p className="mt-2 text-sm">Purchase cost: {formatCurrency(stock.total_cost)}. Check the quantity, batch and expiry above before saving.</p>}</div><details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold">Current selling prices</summary>{medicine.units.map((u) => <p key={u.unit_key} className="mt-2 text-sm">1 {u.label}: {formatCurrency(u.selling_price)}</p>)}<Link href={"/medicines/" + medicine.id + "/edit"} className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-blue-700">Edit selling prices</Link></details><div className="sticky bottom-[76px] z-20 flex gap-3 bg-white/95 py-3 lg:bottom-0">{review && <Button type="button" variant="outline" disabled={pending} onClick={() => setReview(false)}>Back</Button>}<Button className="flex-1" size="lg" disabled={pending}>{pending && <LoaderCircle className="animate-spin" />}{review ? "Add to Stock" : "Review Stock"}</Button></div></form>}</>}{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}</div>;
}
