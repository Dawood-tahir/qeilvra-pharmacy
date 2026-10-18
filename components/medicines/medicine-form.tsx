"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { saveGuidedMedicineAction } from "@/app/(app)/medicines/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { baseUnitFor, medicineTypes, pluralUnit, priceSuggestion, stockQuantity, type SellingUnit } from "@/lib/medicine-units";
import { guidedMedicineSchema, receiveStockSchema } from "@/lib/guided-medicine";
import { cn, formatCurrency, formatDate, localDateISO } from "@/lib/utils";

type Initial = { is_active?: boolean; name?: string; dosage_form?: string; strength?: string; barcode?: string; manufacturer?: string; generic_name?: string; sku?: string; reorder_level?: number; selling_price?: number; tablets_per_strip?: number | null; strips_per_box?: number | null; packaging_status?: string; units?: SellingUnit[] };
export function MedicineForm({ id = null, initialValues = {} }: { id?: string | null; categories?: { id: string; name: string }[]; initialValues?: Initial }) {
  const [step, setStep] = useState(1);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [success, setSuccess] = useState<{ id: string; quantity: number } | null>(null);
  const key = useRef(crypto.randomUUID());
  const busy = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [details, setDetails] = useState({ is_active: initialValues.is_active ?? true, name: initialValues.name ?? "", dosage_form: medicineTypes.find((t) => t.toLowerCase() === initialValues.dosage_form?.toLowerCase()) ?? "Tablet", strength: initialValues.strength ?? "", barcode: initialValues.barcode ?? "", manufacturer: initialValues.manufacturer ?? "", generic_name: initialValues.generic_name ?? "", sku: initialValues.sku ?? "", reorder_level: Number(initialValues.reorder_level ?? 10) });
  const [hasStrips, setHasStrips] = useState(Boolean(initialValues.tablets_per_strip));
  const [hasBoxes, setHasBoxes] = useState(Boolean(initialValues.strips_per_box));
  const [stripSize, setStripSize] = useState(String(initialValues.tablets_per_strip ?? ""));
  const [boxSize, setBoxSize] = useState(String(initialValues.strips_per_box ?? ""));
  const [confirmed, setConfirmed] = useState(false);
  const [stock, setStock] = useState({ unit_key: "base", quantity: "", batch_number: "", expiry_date: "", total_cost: "" });
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(["base", "strip", "box"].map((unit) => [unit, String(initialValues.units?.find((u) => u.unit_key === unit)?.selling_price ?? (unit === "base" ? initialValues.selling_price ?? "" : ""))])));
  const [limits, setLimits] = useState<Record<string, string>>(() => Object.fromEntries(["base", "strip", "box"].map((unit) => [unit, String(initialValues.units?.find((u) => u.unit_key === unit)?.max_price ?? "")])));
  const [edited, setEdited] = useState<Record<string, boolean>>({ strip: Boolean(initialValues.units?.some((u) => u.unit_key === "strip")), box: Boolean(initialValues.units?.some((u) => u.unit_key === "box")) });
  const split = details.dosage_form === "Tablet" || details.dosage_form === "Capsule";
  const base = baseUnitFor(details.dosage_form);
  const strip = hasStrips && split ? Number(stripSize) : 0;
  const box = hasBoxes && split ? Number(boxSize) : 0;
  const packagingLocked = Boolean(id && initialValues.packaging_status === "confirmed");
  const units = [ { key: "base", label: base, factor: 1 }, ...(hasStrips && split ? [{ key: "strip", label: "strip", factor: strip }] : []), ...(hasBoxes && split ? [{ key: "box", label: "box", factor: strip * box }] : []) ];
  const factor = units.find((u) => u.key === stock.unit_key)?.factor ?? 0;
  const totalStock = stockQuantity(Number(stock.quantity), factor);
  const priceFor = (unit: typeof units[number]) => unit.key !== "base" && !edited[unit.key] ? (prices.base ? priceSuggestion(prices.base, unit.factor) : "") : prices[unit.key] ?? "";
  const stockData = { ...stock, unit_key: stock.unit_key as "base" | "strip" | "box", quantity: Number(stock.quantity) };
  const data = { ...details, tablets_per_strip: strip || null, strips_per_box: box || null, confirm_existing: confirmed, units: units.map((u) => ({ unit_key: u.key as "base" | "strip" | "box", selling_price: priceFor(u), max_price: limits[u.key] || null })) };
  function go(next: number) { setError(""); setStep(next); requestAnimationFrame(() => heading.current?.focus()); }
  function next() {
    setError("");
    if (step === 1) {
      if (details.name.trim().length < 2) { setError("Enter the medicine name."); return; }
      startTransition(async () => {
        try {
          const response = await fetch("/api/medicines/search?q=" + encodeURIComponent(details.name.trim()) + "&limit=50", { cache: "no-store" });
          if (!response.ok) throw new Error("Could not check for an existing medicine. Try again.");
          const matches = await response.json() as Array<Initial & { id: string }>;
          if (matches.some((m) => m.id !== id && m.name?.trim().toLowerCase() === details.name.trim().toLowerCase() && (m.strength ?? "").trim().toLowerCase() === details.strength.trim().toLowerCase() && (m.dosage_form ?? "").toLowerCase() === details.dosage_form.toLowerCase() && (m.manufacturer ?? "").trim().toLowerCase() === details.manufacturer.trim().toLowerCase())) { setError("This medicine already exists. Use Add More Stock from Inventory."); return; }
          go(2);
        } catch (e) { setError(e instanceof Error ? e.message : "Check your connection and try again."); }
      });
      return;
    }
    if (split && ((hasStrips && !stockQuantity(1, strip)) || (hasBoxes && (!hasStrips || !stockQuantity(1, strip * box))))) { setError("Enter whole, positive numbers for the packaging shown."); return; }
    if (id && initialValues.packaging_status !== "confirmed" && !confirmed) { setError("Check the existing stock unit before confirming packaging."); return; }
    if (!id) {
      const parsed = receiveStockSchema.safeParse(stockData);
      if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
      if (!totalStock) { setError("Check the purchased quantity and packaging."); return; }
    }
    go(3);
  }
  function save() {
    if (busy.current) return;
    const parsed = guidedMedicineSchema.safeParse(data);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    busy.current = true;
    startTransition(async () => {
      try {
        const result = await saveGuidedMedicineAction(id, parsed.data, id ? null : stockData, key.current);
        if (!result.ok) { setError(result.error); setUncertain(Boolean(result.uncertain)); return; }
        setUncertain(false); setSuccess(result); requestAnimationFrame(() => heading.current?.focus());
      } catch { setUncertain(true); setError("Could not confirm the save. Retry these same entries to check their status."); }
      finally { busy.current = false; }
    });
  }
  if (success) return <section className="mx-auto max-w-lg py-8 text-center"><CheckCircle2 className="mx-auto size-14 text-emerald-600" /><h2 ref={heading} tabIndex={-1} className="mt-4 text-2xl font-extrabold">{id ? "Medicine updated successfully." : "Medicine added successfully."}</h2>{!id && <p className="mt-3 text-slate-600">{pluralUnit(base, success.quantity)} {success.quantity === 1 ? "is" : "are"} now available.</p>}<div className="mt-6 flex flex-col gap-3">{!id && <Button onClick={() => { setSuccess(null); setStep(1); setError(""); setDetails({ is_active: true, name: "", dosage_form: "Tablet", strength: "", barcode: "", manufacturer: "", generic_name: "", sku: "", reorder_level: 10 }); setHasStrips(false); setHasBoxes(false); setStripSize(""); setBoxSize(""); setStock({ unit_key: "base", quantity: "", batch_number: "", expiry_date: "", total_cost: "" }); setPrices({}); setLimits({}); setEdited({}); key.current = crypto.randomUUID(); }}>Add Another Medicine</Button>}<Link className={buttonVariants({ variant: "outline" })} href={"/medicines/" + success.id}>View Medicine</Link><Link className={buttonVariants({ variant: "ghost" })} href="/medicines">Done</Link></div></section>;
  return <form noValidate onSubmit={(e) => { e.preventDefault(); if (!pending) { if (step < 3) next(); else save(); } }} className="mx-auto max-w-2xl space-y-5">
    <ol aria-label="Medicine steps" className="flex gap-2">{["Medicine", id ? "Packaging" : "Stock", "Selling Prices"].map((label, i) => <li key={label} aria-current={step === i + 1 ? "step" : undefined} className={cn("flex-1 rounded-xl px-2 py-3 text-center text-xs font-bold sm:text-sm", step === i + 1 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500")}>{i + 1}. {label}</li>)}</ol>
    <div><p className="text-xs font-bold text-blue-700">Step {step} of 3</p><h2 ref={heading} tabIndex={-1} className="mt-1 text-xl font-extrabold outline-none">{step === 1 ? "Which medicine?" : step === 2 ? id ? "Confirm the packaging" : "How much stock did you buy?" : "How much will you sell it for?"}</h2></div>
    <fieldset disabled={pending || uncertain} className="min-w-0">
    {step === 1 && <div className="space-y-4">
      <Field label="Medicine Name" required><Input autoFocus value={details.name} maxLength={160} onChange={(e) => setDetails({ ...details, name: e.target.value })} placeholder="e.g. Paracetamol" /></Field>
      <Field label="Medicine Type"><select className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3" disabled={packagingLocked} value={details.dosage_form} onChange={(e) => { setDetails({ ...details, dosage_form: e.target.value as typeof details.dosage_form }); setStock({ ...stock, unit_key: "base" }); }} >{medicineTypes.map((type) => <option key={type}>{type}</option>)}</select></Field>
      <Field label="Strength (if applicable)"><Input value={details.strength} maxLength={80} onChange={(e) => setDetails({ ...details, strength: e.target.value })} placeholder="e.g. 500mg" /></Field>
      <Field label="Barcode (optional)"><Input value={details.barcode} maxLength={80} onChange={(e) => setDetails({ ...details, barcode: e.target.value })} /></Field>
      <Field label="Manufacturer (optional)"><Input value={details.manufacturer} maxLength={160} onChange={(e) => setDetails({ ...details, manufacturer: e.target.value })} /></Field>
      <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-600">More medicine details</summary><div className="mt-3 space-y-3">{id && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={details.is_active} onChange={(e) => setDetails({ ...details, is_active: e.target.checked })} className="size-5 accent-blue-600" /> Active medicine (available for sales)</label>}<Field label="Generic name (optional)"><Input value={details.generic_name} onChange={(e) => setDetails({ ...details, generic_name: e.target.value })} /></Field><Field label={"Warn when fewer than this many " + base + "s remain"}><Input type="number" inputMode="numeric" min="0" step="1" value={details.reorder_level} onChange={(e) => setDetails({ ...details, reorder_level: Number(e.target.value) })} /></Field></div></details>
    </div>}
    {step === 2 && <div className="space-y-4">
      {!id && <><p className="text-sm text-slate-500">Read the packaging and confirm the counts below.</p><fieldset><legend className="mb-2 text-sm font-semibold">What did you buy?</legend><div className="flex flex-wrap gap-2">{(split ? [{ key: "box", label: "Boxes" }, { key: "strip", label: "Strips" }, { key: "base", label: "Loose " + base + "s" }] : [{ key: "base", label: base[0].toUpperCase() + base.slice(1) + "s" }]).map((u) => <button type="button" key={u.key} aria-pressed={stock.unit_key === u.key} onClick={() => { setStock({ ...stock, unit_key: u.key }); if (u.key !== "base") setHasStrips(true); if (u.key === "box") setHasBoxes(true); }} className={cn("min-h-12 flex-1 rounded-xl border px-3 py-2 font-bold", stock.unit_key === u.key ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200")}>{u.label}</button>)}</div></fieldset><Field label="How many did you buy?" required><Input type="number" inputMode="numeric" min="1" step="1" value={stock.quantity} onChange={(e) => setStock({ ...stock, quantity: e.target.value })} /></Field></>}
      {split && <fieldset disabled={packagingLocked} className="space-y-4 rounded-xl bg-slate-50 p-4"><legend className="text-sm font-bold">Packaging on the medicine</legend><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5 accent-blue-600" checked={hasStrips} onChange={(e) => { setHasStrips(e.target.checked); if (!e.target.checked) { setHasBoxes(false); setStock({ ...stock, unit_key: "base" }); } }} /> This medicine comes in strips</label>{hasStrips && <Field label={"How many " + base + "s are in one strip?"} required><Input type="number" inputMode="numeric" min="1" step="1" value={stripSize} onChange={(e) => setStripSize(e.target.value)} /></Field>}{hasStrips && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5 accent-blue-600" checked={hasBoxes} onChange={(e) => { setHasBoxes(e.target.checked); if (!e.target.checked && stock.unit_key === "box") setStock({ ...stock, unit_key: "strip" }); }} /> It also comes in boxes</label>}{hasBoxes && <Field label="How many strips are in one box?" required><Input type="number" inputMode="numeric" min="1" step="1" value={boxSize} onChange={(e) => setBoxSize(e.target.value)} /></Field>}</fieldset>}
      {!split && <p className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">Each {base} is one whole sealed item. It cannot be split at checkout.</p>}
      {!id ? <><div aria-live="polite" className="rounded-xl bg-blue-50 p-4 text-blue-800">{totalStock > 0 && <p className="mb-1 text-sm">{stock.quantity} {stock.unit_key === "box" ? "boxes" : stock.unit_key === "strip" ? "strips" : base + "s"}{stock.unit_key === "box" ? " \u00d7 " + box + " strips" : ""}{stock.unit_key !== "base" ? " \u00d7 " + strip + " " + base + "s" : ""}</p>}<p className="text-lg font-extrabold">Total stock: {pluralUnit(base, totalStock)}</p></div><Field label="Batch number" required><Input value={stock.batch_number} maxLength={80} onChange={(e) => setStock({ ...stock, batch_number: e.target.value })} placeholder="Printed on the pack" /></Field><Field label="Expiry date" required><Input type="date" min={localDateISO()} value={stock.expiry_date} onChange={(e) => setStock({ ...stock, expiry_date: e.target.value })} /></Field><Field label="Total purchase cost (Rs.)" required><Input inputMode="decimal" value={stock.total_cost} onChange={(e) => setStock({ ...stock, total_cost: e.target.value })} placeholder="What you paid for all of this stock" /></Field></> : initialValues.packaging_status !== "confirmed" && <label className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><input type="checkbox" className="mt-1 size-5 shrink-0" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>I have checked the physical stock. Existing stock counts represent {base}s, not packs. Confirming packaging keeps these counts unchanged.</span></label>}
    </div>}
    {step === 3 && <div className="space-y-4"><p className="text-sm text-slate-500">Suggested pack prices follow the single {base} price. You can set each price separately.</p>{units.map((u) => <div key={u.key} className="rounded-xl border border-slate-200 p-4"><Field label={"Price of 1 " + u.label[0].toUpperCase() + u.label.slice(1) + (u.factor > 1 ? " (" + u.factor + " " + base + "s)" : "") + " (Rs.)"} required><Input className="h-14 text-lg font-bold" inputMode="decimal" value={priceFor(u)} onChange={(e) => { setEdited({ ...edited, [u.key]: true }); setPrices({ ...prices, [u.key]: e.target.value }); }} /></Field><details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-500">Permitted selling-price limit (optional)</summary><Field label={"Maximum price of 1 " + u.label + " (Rs.)"}><Input className="mt-2" inputMode="decimal" value={limits[u.key] ?? ""} onChange={(e) => setLimits({ ...limits, [u.key]: e.target.value })} /></Field><p className="mt-1 text-xs text-slate-500">Use the applicable printed MRP or legal limit for this selling unit.</p></details></div>)}<section className="rounded-2xl bg-blue-50 p-4"><h3 className="font-extrabold">{details.name} {details.strength}</h3><p className="mt-2 text-sm">Packaging: {split && hasStrips ? strip + " " + base + "s per strip" + (hasBoxes ? " / " + box + " strips per box" : "") : "Whole " + base + "s"}</p>{!id && <><p className="mt-2 text-sm">Stock: <strong>{pluralUnit(base, totalStock)}</strong></p><p className="mt-1 text-sm">Batch: {stock.batch_number}</p><p className="mt-1 text-sm">Expiry: {stock.expiry_date ? formatDate(stock.expiry_date, { month: "long" }) : "Not set"}</p><p className="mt-1 text-sm">Purchase cost: {formatCurrency(stock.total_cost)}</p><p className="mt-2 text-xs text-slate-600">Saving records the medicine and this delivery together. Do not enter this initial stock again in Purchases.</p></>}{units.map((u) => <p key={u.key} className="mt-2 flex justify-between text-sm"><span>1 {u.label}</span><strong>{formatCurrency(priceFor(u))}</strong></p>)}</section></div>}
    </fieldset>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 flex gap-3 border-t border-slate-100 bg-white/95 py-3 backdrop-blur lg:bottom-0">{step > 1 && !uncertain && <Button type="button" variant="outline" size="lg" className="px-3 text-sm sm:px-6 sm:text-base" onClick={() => go(step - 1)} disabled={pending}><ArrowLeft /> Back</Button>}<Button size="lg" className="min-w-0 flex-1 px-3 text-sm sm:px-6 sm:text-base" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : step < 3 ? <ArrowRight /> : <CheckCircle2 />}{pending ? "Please wait..." : uncertain ? "Retry Save" : step < 3 ? "Next" : id ? "Save Changes" : "Save Medicine"}</Button></div>
  </form>;
}
export function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm font-semibold">{label}{required && <span aria-hidden="true"> *</span>}</span>{children}</label>;
}
