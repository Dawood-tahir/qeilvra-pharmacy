"use client";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2, CreditCard, LoaderCircle, Minus, Plus, Printer, Search, ShoppingCart, Trash2, X, RotateCcw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";
import { cartBaseQuantity, pluralUnit, toMinor, type StockMedicine, type SellingUnit } from "@/lib/medicine-units";
import { DialogLoading } from "@/components/ui/dialog-loading";
import type { AppRole } from "@/lib/auth";

import { posTotals, validAmount, type DiscountMode } from "@/lib/pos-totals";

type CartItem = StockMedicine & { quantity: number; unit: SellingUnit; lineKey: string; itemDiscount?: string; discountMode?: DiscountMode };
const ReturnLookup = lazy(() => import("@/components/pos/return-lookup").then(module => ({ default: module.ReturnLookup })));
type SaleResult = { sale_id: string; invoice_number: string; net_total: number; change_amount: number };
type CheckoutRequest = { idempotencyKey: string; items: { medicineId: string; unitKey: string; quantity: number; expectedPrice: string; customPrice?: string; lineDiscount?: number }[]; paymentMethod: "cash" | "card"; tenderedAmount: number | null; discount: number; extraAmount?: number; extraDescription?: string; cardConfirmed?: boolean };
const cartSchema = z.array(z.object({
  id: z.string(), name: z.string(), strength: z.string().nullish(), base_unit: z.string(), quantity: z.number().int().positive(),
  available_quantity: z.number(), lineKey: z.string(), itemDiscount: z.string().optional(), discountMode: z.enum(["fixed", "percent"]).optional(),
  unit: z.object({ unit_key: z.string(), label: z.string(), base_quantity: z.number().int().positive(), selling_price: z.number().positive(), max_price: z.number().nonnegative().nullish() }),
}).passthrough());

export function PosWorkspace({ role, staffId = "local", initialMedicines }: { role: AppRole; staffId?: string; initialMedicines?: StockMedicine[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [medicines, setMedicines] = useState<StockMedicine[]>(initialMedicines ?? []);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);
  const [paperWidth, setPaperWidth] = useState<"58" | "80">("80");
  const [cardConfirmed, setCardConfirmed] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [tendered, setTendered] = useState("");
  const [discount, setDiscount] = useState("0");
  const [discountMode, setDiscountMode] = useState<DiscountMode>("fixed");
  const [extraAmount, setExtraAmount] = useState("0");
  const [extraDescription, setExtraDescription] = useState("");
  const [processing, setProcessing] = useState(false);
  const [request, setRequest] = useState<CheckoutRequest | null>(null);
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null);
  const [restored, setRestored] = useState(false);
  const [searchVersion, setSearchVersion] = useState(0);
  const [preferredUnits, setPreferredUnits] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const searchStarted = useRef(false);
  const busyRef = useRef(false);
  const storageKey = "qeilvra-cart-v2-" + staffId;
  const totals = useMemo(() => posTotals(cart, discount, discountMode, extraAmount), [cart, discount, discountMode, extraAmount]);
  const subtotalMinor = totals.subtotal;
  const total = totals.total / 100;
  const change = method === "cash" ? Math.max(toMinor(tendered) - totals.total, 0) / 100 : 0;
  const storedSale = { cart, request, saleResult, discount, discountMode, extraAmount, extraDescription };
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
    if (!active) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      const parsed = cartSchema.safeParse(saved?.cart);
      const fresh = new URLSearchParams(location.search).get("new") === "1";
      if (fresh) { const url = new URL(location.href); url.searchParams.delete("new"); history.replaceState(null, "", url); }
      if (parsed.success && !(fresh && saved.saleResult)) { setCart(parsed.data as CartItem[]); setRequest(saved.request ?? null); setSaleResult(saved.saleResult ?? null); setDiscount(saved.discount ?? "0"); setDiscountMode(saved.discountMode === "percent" ? "percent" : "fixed"); setExtraAmount(saved.extraAmount ?? "0"); setExtraDescription(saved.extraDescription ?? ""); }
      setPreferredUnits(JSON.parse(sessionStorage.getItem("qeilvra-unit-preferences-" + staffId) ?? "{}"));
    } catch { /* An invalid or unavailable browser store must not prevent a sale. */ }
    try { setAutoPrint(localStorage.getItem("qeilvra-auto-print") === "on"); setPaperWidth(localStorage.getItem("qeilvra-paper-width") === "58" ? "58" : "80"); } catch {}
    setRestored(true);
    });
    return () => { active = false; };
  }, [storageKey, staffId]);
  useEffect(() => {
    if (restored) { try { sessionStorage.setItem(storageKey, JSON.stringify({ cart, request, saleResult, discount, discountMode, extraAmount, extraDescription })); } catch { /* Counter still works when storage is unavailable. */ } }
  }, [cart, request, saleResult, discount, discountMode, extraAmount, extraDescription, restored, storageKey]);
  useEffect(() => {
    // Server results cover only the first empty search. Clearing a later search,
    // retrying, and completing checkout must still read current stock from the API.
    if (!searchStarted.current && initialMedicines !== undefined && !query && searchVersion === 0) return;
    searchStarted.current = true;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setSearchError("");
      try {
        const response = await fetch("/api/medicines/search?q=" + encodeURIComponent(query.trim()) + "&limit=30", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!controller.signal.aborted) setMedicines(data);
      } catch { if (!controller.signal.aborted) { setMedicines([]); setSearchError("Could not load medicines. Check your connection and try again."); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, query ? 220 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, searchVersion, initialMedicines]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => { if (e.key === "F4") { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, []);
  function printing(value: boolean) { setAutoPrint(value); try { localStorage.setItem("qeilvra-auto-print", value ? "on" : "off"); } catch { toast.error("This browser cannot remember printer settings."); } }
  function paper(value: "58" | "80") { setPaperWidth(value); try { localStorage.setItem("qeilvra-paper-width", value); } catch {} }
  function add(medicine: StockMedicine, unit: SellingUnit, quantity: number) {
    if (request || processing) return;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) return;
    if ((cart.find((l) => l.id === medicine.id && l.unit.unit_key === unit.unit_key)?.quantity ?? 0) + quantity > 100000) { toast.error("Use at most 100,000 items on one invoice line."); return; }
    if (cartBaseQuantity(cart, medicine.id) + quantity * unit.base_quantity > medicine.available_quantity) { toast.error("Only " + pluralUnit(medicine.base_unit, medicine.available_quantity) + " are available, including items already in the cart."); return; }
    const lineKey = medicine.id + ":" + unit.unit_key;
    setCart((current) => {
      const existing = current.find((line) => line.lineKey === lineKey);
      return existing ? current.map((line) => line.lineKey === lineKey ? { ...line, quantity: line.quantity + quantity } : line) : [...current, { ...medicine, quantity, unit, lineKey }];
    });
    const next = { ...preferredUnits, [medicine.id]: unit.unit_key };
    setPreferredUnits(next);
    try { sessionStorage.setItem("qeilvra-unit-preferences-" + staffId, JSON.stringify(next)); } catch {}
    toast.success(quantity + " " + unit.label + (quantity === 1 ? "" : "s") + " added to cart.");
  }
  function quantity(lineKey: string, count: number) {
    if (request || processing || !Number.isSafeInteger(count) || count > 100000) return;
    const line = cart.find((item) => item.lineKey === lineKey);
    if (!line) return;
    const available = medicines.find((m) => m.id === line.id)?.available_quantity ?? line.available_quantity;
    if (cartBaseQuantity(cart.filter((item) => item.lineKey !== lineKey), line.id) + count * line.unit.base_quantity > available) { toast.error("Only " + pluralUnit(line.base_unit, available) + " are available."); return; }
    setCart((current) => count <= 0 ? current.filter((line) => line.lineKey !== lineKey) : current.map((line) => line.lineKey === lineKey ? { ...line, quantity: count } : line));
  }
  async function checkout() {
    if (!cart.length || busyRef.current || saleResult) return;
    if (!request && method === "card" && !cardConfirmed) return;
    if (!request && (!validAmount(discount) || (discountMode === "percent" ? Number(discount) > 100 : toMinor(discount) > subtotalMinor - totals.itemDiscount) || !validAmount(extraAmount) || cart.some(line => !validAmount(line.itemDiscount ?? "0") || (line.discountMode === "percent" ? Number(line.itemDiscount) > 100 : toMinor(line.itemDiscount ?? "0") > toMinor(line.unit.selling_price) * line.quantity)))) { toast.error("Check discount limits and enter a valid extra amount of zero or more."); return; }
    if (!request && method === "cash" && toMinor(tendered) < totals.total) return;
    const payload: CheckoutRequest = request ?? { idempotencyKey: crypto.randomUUID(), items: cart.map((line, index) => ({ medicineId: line.id, unitKey: line.unit.unit_key, quantity: line.quantity, expectedPrice: Number(line.unit.selling_price).toFixed(2), ...(totals.lines[index].discount > 0 ? { lineDiscount: totals.lines[index].discount / 100 } : {}) })), paymentMethod: method, tenderedAmount: method === "cash" ? toMinor(tendered) / 100 : null, discount: totals.invoiceDiscount / 100, extraAmount: totals.extraAmount / 100, extraDescription: extraDescription.trim(), ...(method === "card" ? { cardConfirmed } : {}) };
    busyRef.current = true; setProcessing(true); setRequest(payload);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ ...storedSale, request: payload }));
    } catch {
      setRequest(null); busyRef.current = false; setProcessing(false);
      toast.error("Allow browser storage before checkout so an interrupted sale can be retried safely.");
      return;
    }
    try {
      const response = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) {
        // Permission/session failures on a retry may hide an already committed sale.
        // Only a known transaction rollback (or first-attempt validation failure) unlocks editing.
        if ((!request && response.status === 400) || response.status === 409 || (response.status === 403 && result.error === "Discount exceeds the salesperson limit.")) { setRequest(null); setSearchVersion((n) => n + 1); }
        throw new Error(result.error ?? "The sale could not be confirmed. Retry to check its status.");
      }
      if (!result.sale_id || !result.invoice_number) throw new Error("The sale could not be confirmed. Retry to check its status.");
      setSaleResult(result); setRequest(null); setPaymentOpen(false); setCartOpen(false);
      try { sessionStorage.setItem(storageKey, JSON.stringify({ ...storedSale, request: null, saleResult: result })); } catch {}
      toast.success("Sale completed.");
      if (autoPrint) router.push("/sales/" + result.sale_id + "?print=thermal&width=" + paperWidth);
    } catch (error) { toast.error(error instanceof Error ? error.message : "The sale could not be confirmed. Retry this sale before starting another."); }
    finally { busyRef.current = false; setProcessing(false); }
  }
  function nextSale() { setCart([]); setExtraAmount("0"); setExtraDescription(""); setDiscountMode("fixed"); setCardConfirmed(false); setRequest(null); setSaleResult(null); setDiscount("0"); setTendered(""); setMethod("cash"); setQuery(""); setSearchVersion((n) => n + 1); }
  if (saleResult) return <main className="grid min-h-[70vh] place-items-center p-4"><Card className="w-full max-w-lg p-6 text-center"><CheckCircle2 className="mx-auto size-14 text-emerald-600" /><p className="mt-4 text-sm font-bold text-emerald-700">Sale completed</p><h1 className="mt-2 text-xl font-extrabold">{saleResult.invoice_number}</h1><p className="mt-4 text-3xl font-extrabold">{formatCurrency(saleResult.net_total)}</p>{Number(saleResult.change_amount) > 0 && <p className="mt-2">Change: {formatCurrency(saleResult.change_amount)}</p>}<div className="mt-6 grid gap-3"><Link className={buttonVariants({ size: "lg" })} href={"/sales/" + saleResult.sale_id + "?print=thermal&width=" + paperWidth}><Printer /> Print receipt</Link><Button size="lg" variant="outline" onClick={nextSale}>Next sale</Button></div></Card></main>;
  const panel = <CartPanel cart={cart} subtotal={subtotalMinor / 100} total={total} discount={discount} onDiscount={setDiscount} discountMode={discountMode} onDiscountMode={setDiscountMode} appliedDiscount={totals.discount / 100} extraAmount={extraAmount} onExtraAmount={setExtraAmount} extraDescription={extraDescription} onExtraDescription={setExtraDescription} onItemDiscount={(key, value, mode) => setCart(current => current.map(line => line.lineKey === key ? { ...line, itemDiscount: value, discountMode: mode } : line))} onQuantity={quantity} onCheckout={() => { if (!request) setCardConfirmed(false); setCartOpen(false); setPaymentOpen(true); }} locked={Boolean(request) || processing} autoPrint={autoPrint} onAutoPrint={printing} paperWidth={paperWidth} onPaperWidth={paper} onReturn={() => { setCartOpen(false); setReturnOpen(true); }} />;
  return <main data-role={role} className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-[1600px] flex-col gap-4 p-3 pb-40 sm:p-5 sm:pb-40 lg:h-[calc(100dvh-4.5rem)] lg:flex-row lg:overflow-hidden lg:p-6">
    <section className="flex min-w-0 flex-1 flex-col lg:overflow-hidden"><div><p className="text-xs font-bold text-blue-700">Point of Sale</p><h1 className="text-2xl font-extrabold">New sale</h1></div>
      <div className="relative mt-3"><Search className="absolute left-3 top-3.5 size-5 text-slate-400" /><Input ref={searchRef} autoFocus className="h-12 pl-11 text-base" aria-label="Medicine search" placeholder="Search or scan medicine" value={query} onChange={(e) => { setQuery(e.target.value); setMedicines([]); setLoading(true); setSearchError(""); }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === "ArrowDown") && !loading) { event.preventDefault(); document.getElementById("pos-medicines")?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); } }} /></div><p className="mt-2 text-xs text-slate-500">Choose a selling unit, then add to cart. F4 focuses search.</p>
      {request && <div role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Sale status is unconfirmed. Retry safely before changing the cart.<Button className="mt-2 w-full" onClick={() => setPaymentOpen(true)}>Retry Sale</Button></div>}
      {searchError && <div role="alert" className="mt-3 text-sm text-red-700">{searchError}<Button variant="ghost" onClick={() => setSearchVersion((n) => n + 1)}>Try again</Button></div>}
      <div id="pos-medicines" aria-busy={loading} className="scrollbar-thin mt-4 grid flex-1 auto-rows-min grid-cols-1 gap-2 overflow-y-auto pb-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3">
        {loading && !medicines.length && <><p role="status" className="col-span-full text-sm text-slate-500">Finding medicines...</p>{[0,1,2,3,4,5].map(index => <div key={index} aria-hidden="true" className={cn("rounded-xl border border-slate-200 bg-white p-3", index > 1 && "hidden sm:block")}><div className="skeleton h-4 w-2/3 rounded" /><div className="skeleton mt-2 h-3 w-1/2 rounded" /><div className="skeleton mt-5 h-11 rounded-lg" /><div className="skeleton mt-3 h-8 rounded-lg" /><div className="skeleton mt-3 h-11 rounded-lg" /></div>)}</>}
        {!loading && !searchError && !medicines.length && <p className="col-span-full rounded-xl bg-white p-6 text-sm text-slate-500">No medicines found. Try another name or barcode.</p>}
        {medicines.map((m) => <MedicineCard key={m.id} medicine={m} preferred={preferredUnits[m.id]} inCart={cartBaseQuantity(cart, m.id)} locked={Boolean(request) || processing} onAdd={(u, q) => add(m, u, q)} />)}
      </div>
    </section>
    <aside aria-label="Cart" className="hidden w-[360px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white lg:flex">{panel}</aside>
    <div className="fixed inset-x-0 bottom-[calc(69px+env(safe-area-inset-bottom))] z-40 border-t border-slate-200 bg-white p-3 lg:hidden"><Button size="lg" className="w-full justify-between" onClick={() => setCartOpen(true)}><span className="flex items-center gap-2"><ShoppingCart />{cart.length ? "Cart & Checkout" : "View cart"}</span><strong>{formatCurrency(total)}</strong></Button></div>
    {cartOpen && <Dialog label="Current sale" fallbackFocus={searchRef} fullScreen onClose={() => setCartOpen(false)}><div className="flex h-full flex-col"><div className="flex items-center justify-between border-b p-3"><h2 className="font-bold">Current sale</h2><Button variant="ghost" aria-label="Close cart" size="icon" onClick={() => setCartOpen(false)}><X /></Button></div>{panel}</div></Dialog>}
    {paymentOpen && <Dialog label="Complete sale" fallbackFocus={searchRef} busy={processing} onClose={() => setPaymentOpen(false)}><div className="flex items-center justify-between"><h2 className="text-xl font-extrabold">{request ? "Confirm sale status" : "Complete sale"}</h2><Button variant="ghost" size="icon" aria-label="Close payment" disabled={processing} onClick={() => setPaymentOpen(false)}><X /></Button></div><div className="mt-5 rounded-xl bg-slate-950 p-5 text-white"><p className="text-sm text-slate-300">Total amount</p><p className="mt-1 text-3xl font-extrabold">{formatCurrency(request ? request.items.reduce((s, l) => s + toMinor(l.customPrice ?? l.expectedPrice) * l.quantity, 0) / 100 - request.discount - request.items.reduce((sum, line) => sum + (line.lineDiscount ?? 0), 0) + (request.extraAmount ?? 0) : total)}</p></div>{!request && <><BillDetails subtotal={subtotalMinor / 100} discount={totals.discount / 100} extraAmount={totals.extraAmount / 100} extraDescription={extraDescription} total={total} /><fieldset className="mt-4 flex gap-2" disabled={processing}><legend className="mb-2 text-sm font-bold">Payment method</legend>{(["cash", "card"] as const).map((value) => <Button key={value} variant={method === value ? "default" : "outline"} className="h-12 flex-1 capitalize" aria-pressed={method === value} onClick={() => { setMethod(value); setCardConfirmed(false); }}>{value}</Button>)}</fieldset>{method === "cash" && <label className="mt-4 block"><span className="mb-2 block text-sm font-bold">Cash received (Rs.)</span><Input autoFocus inputMode="decimal" value={tendered} disabled={processing} onChange={(e) => setTendered(e.target.value)} /><Button className="mt-2" variant="secondary" disabled={processing} onClick={() => setTendered(total.toFixed(2))}>Exact amount</Button><p className="mt-3 text-sm">Change: <strong>{formatCurrency(change)}</strong></p></label>}{method === "card" && <label className="mt-4 flex items-center gap-3 rounded-xl bg-blue-50 p-3 text-sm"><input type="checkbox" className="size-5 shrink-0" checked={cardConfirmed} disabled={processing} onChange={(e) => setCardConfirmed(e.target.checked)} />Payment confirmed on the external card machine</label>}</>}<Button size="lg" className="mt-5 w-full" onClick={checkout} disabled={processing || !cart.length || (!request && method === "card" && !cardConfirmed) || (!request && method === "cash" && toMinor(tendered) < totals.total)}>{processing ? <><LoaderCircle className="animate-spin" /> Completing sale...</> : request ? "Retry Sale" : "Complete Sale"}</Button></Dialog>}
    {returnOpen && <Suspense fallback={<DialogLoading label="Return / Refund" onClose={() => setReturnOpen(false)} />}>
      <ReturnLookup staffId={staffId} onReturned={() => setSearchVersion((version) => version + 1)} onClose={() => setReturnOpen(false)} />
    </Suspense>}
  </main>;
}

function MedicineCard({ medicine: m, preferred, inCart, locked, onAdd }: { medicine: StockMedicine; preferred?: string; inCart: number; locked: boolean; onAdd: (unit: SellingUnit, quantity: number) => void }) {
  const [selected, setSelected] = useState(preferred ?? "base");
  const [quantity, setQuantity] = useState(1);
  const unit = m.units.find((u) => u.unit_key === selected && u.base_quantity <= m.available_quantity) ?? m.units.find((u) => u.base_quantity <= m.available_quantity) ?? m.units[0];
  const available = m.available_quantity - inCart;
  const price = unit ? Number(unit.selling_price) : 0;
  return <article aria-label={m.name + " " + (m.strength ?? "")} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
    <h2 className="break-words text-sm font-extrabold">{m.name} {m.strength}</h2>
    <p className="mt-0.5 text-xs text-slate-500">{m.manufacturer || m.generic_name || m.dosage_form}</p>
    <p className={cn("mt-1 text-xs font-semibold", m.stock_status === "in_stock" ? "text-emerald-700" : "text-amber-700")}>Available: {pluralUnit(m.base_unit, m.available_quantity)}{inCart > 0 ? " (" + inCart + " in cart)" : ""}</p>
    {m.is_active === false || m.packaging_status !== "confirmed" || !unit ? <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Owner review needed before selling.</p> : <>
      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Selling unit">{m.units.map((u) => <button key={u.unit_key} disabled={locked || u.base_quantity > available} aria-pressed={unit.unit_key === u.unit_key} onClick={() => { setSelected(u.unit_key); setQuantity(1); }} className={cn("min-h-11 flex-1 rounded-lg border px-2 text-sm font-bold capitalize disabled:opacity-40", unit.unit_key === u.unit_key ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200")}>{u.label}</button>)}</div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 text-sm"><p className="font-bold text-blue-700">{formatCurrency(price)} <span className="text-xs font-normal text-slate-500">/ {unit.label}</span></p><strong>{formatCurrency(toMinor(price) * quantity / 100)}</strong></div>
      {unit.base_quantity > 1 && <p className="mt-1 text-xs text-slate-500">1 {unit.label} = {pluralUnit(m.base_unit, unit.base_quantity)}</p>}
      <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2"><Quantity key={unit.unit_key} label={"Quantity of " + m.name + " " + unit.label} value={quantity} onChange={setQuantity} min={1} disabled={locked} /><Button className="h-11 px-2 text-sm" disabled={locked || quantity * unit.base_quantity > available || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000} onClick={() => onAdd(unit, quantity)}>Add to Cart</Button></div>
      {quantity * unit.base_quantity > available && <p role="status" className="mt-2 text-xs text-amber-800">Only {pluralUnit(m.base_unit, available)} left outside the cart.</p>}
    </>}
  </article>;
}
function Quantity({ label, value, onChange, min = 0, disabled }: { label: string; value: number; onChange: (n: number) => void; min?: number; disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <div className="flex items-center rounded-xl border border-slate-200">
    <button type="button" className="grid size-11 place-items-center disabled:opacity-40" disabled={disabled || value <= min} aria-label={"Decrease " + label} onClick={() => { setDraft(null); onChange(value - 1); }}><Minus className="size-4" /></button>
    <input aria-label={label} type="number" inputMode="numeric" step="1" min={min} max={100000} className="h-11 w-12 text-center font-bold outline-none focus:ring-2 focus:ring-blue-500" disabled={disabled} value={draft ?? value}
      onFocus={(event) => event.currentTarget.select()} onBlur={() => setDraft(null)}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
      onChange={(event) => { const text = event.target.value; setDraft(text); if (text !== "") { const n = Number(text); if (Number.isSafeInteger(n) && n >= min && n <= 100000) onChange(n); } }} />
    <button type="button" className="grid size-11 place-items-center disabled:opacity-40" disabled={disabled || value >= 100000} aria-label={"Increase " + label} onClick={() => { setDraft(null); onChange(value + 1); }}><Plus className="size-4" /></button>
  </div>;
}
function DiscountInput({ label, value, mode, onChange, onMode, disabled }: { label: string; value: string; mode: DiscountMode; onChange: (value: string) => void; onMode: (mode: DiscountMode) => void; disabled: boolean }) {
  return <div className="mt-2 space-y-2"><div className="flex gap-1" role="group" aria-label={label + " type"}>{(["fixed", "percent"] as const).map(type => <button type="button" key={type} disabled={disabled} aria-pressed={mode === type} onClick={() => onMode(type)} className={cn("min-h-9 flex-1 rounded-lg border px-2 text-xs font-semibold", mode === type ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white")}>{type === "fixed" ? "Fixed (Rs.)" : "Percentage (%)"}</button>)}</div><div className="flex gap-1"><label className="min-w-0 flex-1 text-xs font-semibold">{label} ({mode === "fixed" ? "Rs." : "%"})<Input inputMode="decimal" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /></label><Button aria-label={"Remove " + label.toLowerCase()} variant="ghost" size="icon" className="self-end" disabled={disabled} onClick={() => onChange("0")}><X className="size-4" /></Button></div></div>;
}

function BillDetails({ subtotal, discount, extraAmount, extraDescription, total }: { subtotal: number; discount: number; extraAmount: number; extraDescription: string; total: number }) {
  return <div className="mt-3 space-y-2 text-sm"><p className="flex justify-between gap-2 text-slate-500"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></p><p className="flex justify-between gap-2 text-emerald-700"><span>Discount</span><span>− {formatCurrency(discount)}</span></p>{extraAmount > 0 && <div className="text-blue-700"><p className="flex justify-between gap-2"><span>Extra Charges</span><span>+ {formatCurrency(extraAmount)}</span></p>{extraDescription && <p className="break-words text-xs">{extraDescription}</p>}</div>}<p className="flex justify-between gap-2 border-t border-slate-200 pt-2 text-xl font-extrabold"><span>Total</span><span>{formatCurrency(total)}</span></p></div>;
}

function CartPanel({ cart, subtotal, total, discount, onDiscount, discountMode, onDiscountMode, appliedDiscount, extraAmount, onExtraAmount, extraDescription, onExtraDescription, onItemDiscount, onQuantity, onCheckout, locked, autoPrint, onAutoPrint, paperWidth, onPaperWidth, onReturn }: { cart: CartItem[]; subtotal: number; total: number; discount: string; onDiscount: (v: string) => void; discountMode: DiscountMode; onDiscountMode: (v: DiscountMode) => void; appliedDiscount: number; extraAmount: string; onExtraAmount: (value: string) => void; extraDescription: string; onExtraDescription: (value: string) => void; onItemDiscount: (key: string, value: string, mode: DiscountMode) => void; onQuantity: (key: string, n: number) => void; onCheckout: () => void; locked: boolean; autoPrint: boolean; onAutoPrint: (value: boolean) => void; paperWidth: "58" | "80"; onPaperWidth: (value: "58" | "80") => void; onReturn: () => void }) {
  return <><div className="border-b p-4"><h2 className="font-extrabold">Cart</h2><p className="text-xs text-slate-500">{cart.length} items</p></div><div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">{!cart.length && <p className="py-12 text-center text-sm text-slate-500">Choose a medicine and tap Add to Cart.</p>}{cart.map(line => <div key={line.lineKey} className="border-b border-slate-100 pb-3 last:border-0"><div className="flex justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-sm font-bold">{line.name} {line.strength}</h3><p className="mt-1 text-xs text-slate-500">{formatCurrency(line.unit.selling_price)} / {line.unit.label}</p></div><button aria-label={"Remove " + line.name + " " + line.unit.label} disabled={locked} className="grid size-11 shrink-0 place-items-center text-slate-400" onClick={() => onQuantity(line.lineKey, 0)}><Trash2 className="size-4" /></button></div><div className="mt-2 flex items-center justify-between gap-2"><Quantity label={line.name + " " + line.unit.label + " in cart"} value={line.quantity} onChange={n => onQuantity(line.lineKey, n)} disabled={locked} /><strong>{formatCurrency(toMinor(line.unit.selling_price) * line.quantity / 100)}</strong></div></div>)}
    <section className="border-t border-slate-200 pt-3" aria-label="Discount"><h3 className="text-sm font-bold">Discount</h3><DiscountInput label="Bill discount" value={discount} mode={discountMode} onChange={onDiscount} onMode={onDiscountMode} disabled={locked} />{cart.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold">Individual medicine discounts</summary>{cart.map(line => <DiscountInput key={line.lineKey} label={line.name + " " + line.unit.label + " discount"} value={line.itemDiscount ?? "0"} mode={line.discountMode ?? "fixed"} onChange={value => onItemDiscount(line.lineKey, value, line.discountMode ?? "fixed")} onMode={mode => onItemDiscount(line.lineKey, line.itemDiscount ?? "0", mode)} disabled={locked} />)}</details>}</section>
    <details className="border-t border-slate-200 pt-3" open={Number(extraAmount) > 0 || undefined}><summary className="cursor-pointer text-sm font-bold">+ Extra Charges</summary><label className="mt-2 block text-xs font-semibold">Description (optional)<Input maxLength={120} value={extraDescription} disabled={locked} onChange={event => onExtraDescription(event.target.value)} /></label><div className="mt-2 flex gap-1"><label className="min-w-0 flex-1 text-xs font-semibold">Extra Amount (Rs.)<Input inputMode="decimal" value={extraAmount} disabled={locked} onChange={event => onExtraAmount(event.target.value)} /></label><Button aria-label="Remove extra charge" className="self-end" size="icon" variant="ghost" disabled={locked} onClick={() => { onExtraAmount("0"); onExtraDescription(""); }}><X className="size-4" /></Button></div></details>
  </div><div className="border-t bg-slate-50 p-4"><BillDetails subtotal={subtotal} discount={appliedDiscount} extraAmount={validAmount(extraAmount) ? Number(extraAmount) : 0} extraDescription={extraDescription} total={total} /><div className="mt-3 flex items-center justify-between gap-2"><button type="button" role="switch" aria-checked={autoPrint} aria-label="Auto Print Receipt" disabled={locked} onClick={() => onAutoPrint(!autoPrint)} className="flex min-h-11 items-center gap-2 text-sm font-semibold"><Printer className="size-4" />Auto Print <span className={cn("rounded-full px-2 py-1 text-xs", autoPrint ? "bg-blue-600 text-white" : "bg-slate-200")}>{autoPrint ? "ON" : "OFF"}</span></button><select aria-label="Receipt paper width" disabled={locked} value={paperWidth} onChange={event => onPaperWidth(event.target.value as "58" | "80")} className="min-h-11 rounded-lg border border-slate-200 bg-white px-1 text-xs"><option value="58">58mm</option><option value="80">80mm</option></select></div><Button size="lg" className="mt-2 w-full" disabled={!cart.length || total <= 0} onClick={onCheckout}><CreditCard />{locked ? "Retry Sale" : "Checkout"}</Button><Button variant="outline" className="mt-2 w-full text-red-600" onClick={onReturn} disabled={locked}><RotateCcw />Return / Refund</Button></div></>;
}
