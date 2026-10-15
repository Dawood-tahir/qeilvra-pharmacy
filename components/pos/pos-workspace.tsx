"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Barcode, CheckCircle2, ChevronLeft, CreditCard, LoaderCircle, Minus, PackageX,
  Plus, Printer, ReceiptText, Search, ShoppingBag, ShoppingCart, Trash2, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";
import type { AppRole } from "@/lib/auth";

type Medicine = { id: string; name: string; generic_name?: string; manufacturer?: string; strength?: string; dosage_form?: string; barcode?: string; sku: string; selling_price: number; base_unit: string; available_quantity: number; nearest_expiry?: string; stock_status: "in_stock" | "low_stock" | "out_of_stock" };
type CartItem = Medicine & { quantity: number };
type SaleResult = { sale_id: string; invoice_number: string; net_total: number; change_amount: number };

export function PosWorkspace({ role }: { role: AppRole }) {
  const [query, setQuery] = useState("");
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [tendered, setTendered] = useState("");
  const [discount, setDiscount] = useState("0");
  const [processing, setProcessing] = useState(false);
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const searchRef = useRef<HTMLInputElement>(null);

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.selling_price * item.quantity, 0), [cart]);
  const discountValue = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const total = subtotal - discountValue;
  const change = paymentMethod === "cash" ? Math.max((Number(tendered) || 0) - total, 0) : 0;
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const search = useCallback(async (term: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/medicines/search?q=${encodeURIComponent(term)}&limit=30`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      setMedicines(await response.json());
    } catch { toast.error("Medicine search failed. Check your connection and try again."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query.trim()), query.trim() ? 220 : 0);
    return () => clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === "F4") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === "Escape") { setPaymentOpen(false); setCartOpen(false); }
    };
    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  }, []);

  const addItem = (medicine: Medicine) => {
    if (medicine.available_quantity <= 0) { toast.error(`${medicine.name} is unavailable.`); return; }
    setCart((current) => {
      const existing = current.find((item) => item.id === medicine.id);
      if (existing) {
        if (existing.quantity + 1 > medicine.available_quantity) { toast.error(`Only ${medicine.available_quantity} units available.`); return current; }
        return current.map((item) => item.id === medicine.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...current, { ...medicine, quantity: 1 }];
    });
  };
  const setQuantity = (id: string, quantity: number) => setCart((current) => current.flatMap((item) => {
    if (item.id !== id) return [item];
    if (quantity <= 0) return [];
    if (quantity > item.available_quantity) { toast.error(`Only ${item.available_quantity} units available.`); return [item]; }
    return [{ ...item, quantity }];
  }));

  const checkout = async () => {
    if (!cart.length || processing) return;
    if (paymentMethod === "cash" && (Number(tendered) || 0) < total) { toast.error("Cash received is less than the amount due."); return; }
    setProcessing(true);
    try {
      const response = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: idempotencyKey.current, items: cart.map((item) => ({ medicineId: item.id, quantity: item.quantity })), paymentMethod, tenderedAmount: paymentMethod === "cash" ? Number(tendered) : null, discount: discountValue, customerName: null, paymentReference: null }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Checkout failed.");
      setSaleResult(result); setPaymentOpen(false); setCartOpen(false); toast.success("Sale completed and stock updated.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Checkout failed. No changes were saved."); }
    finally { setProcessing(false); }
  };

  const resetSale = () => { setCart([]); setQuery(""); setTendered(""); setDiscount("0"); setPaymentMethod("cash"); setSaleResult(null); idempotencyKey.current = crypto.randomUUID(); searchRef.current?.focus(); search(""); };

  if (saleResult) return <main className="grid min-h-[calc(100vh-4rem)] place-items-center p-4"><Card className="w-full max-w-lg p-6 text-center sm:p-8"><span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-50 text-emerald-700"><CheckCircle2 className="size-9" /></span><p className="mt-5 text-sm font-semibold text-emerald-700">Payment successful</p><h1 className="mt-1 text-2xl font-extrabold">{saleResult.invoice_number}</h1><p className="mt-3 text-3xl font-extrabold tabular-nums">{formatCurrency(saleResult.net_total)}</p>{saleResult.change_amount > 0 && <p className="mt-2 text-sm text-slate-500">Change due: <strong className="text-slate-900">{formatCurrency(saleResult.change_amount)}</strong></p>}<div className="mt-7 grid gap-3 sm:grid-cols-2"><Link className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white hover:bg-blue-700" href={`/sales/${saleResult.sale_id}?print=thermal`}><Printer /> Print receipt</Link><Button variant="outline" size="lg" onClick={resetSale}><ShoppingCart /> Next sale</Button></div><Link href={`/sales/${saleResult.sale_id}`} className="mt-4 inline-block text-sm font-semibold text-blue-700">View standard invoice</Link></Card></main>;

  return (
    <main data-role={role} className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1600px] flex-col p-3 pb-28 sm:p-5 sm:pb-28 lg:h-[calc(100vh-4.5rem)] lg:flex-row lg:gap-4 lg:overflow-hidden lg:p-6">
      <section className="flex min-w-0 flex-1 flex-col lg:overflow-hidden">
        <div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-bold text-blue-700">Point of Sale</p><h1 className="text-xl font-extrabold sm:text-2xl">New sale</h1></div><Badge variant="success">Live stock</Badge></div>
        <div className="relative"><Search className="absolute left-3 top-3.5 size-5 text-slate-400" /><Input ref={searchRef} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} className="h-12 pl-11 pr-12 text-base" placeholder="Search medicine, generic, barcode or SKU" aria-label="Medicine search" /><Barcode className="absolute right-3 top-3.5 size-5 text-blue-600" /></div>
        <p className="mt-2 text-[11px] text-slate-500">Press F4 to focus search. Barcode scans work when the scanner sends Enter.</p>
        <div className="scrollbar-thin mt-4 grid flex-1 auto-rows-min grid-cols-1 gap-2 overflow-y-auto pb-3 sm:grid-cols-2 xl:grid-cols-3">
          {loading && medicines.length === 0 && Array.from({ length: 6 }).map((_, index) => <div key={index} className="skeleton h-32 rounded-2xl" />)}
          {!loading && medicines.length === 0 && <div className="col-span-full grid min-h-64 place-items-center text-center"><div><PackageX className="mx-auto size-10 text-slate-300" /><p className="mt-3 font-bold">No sellable medicines found</p><p className="mt-1 text-sm text-slate-500">Try a name, generic name, barcode or SKU.</p></div></div>}
          {medicines.map((medicine) => <button key={medicine.id} disabled={medicine.available_quantity <= 0} onClick={() => addItem(medicine)} className="group flex min-h-28 items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><ShoppingBag className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate font-bold text-slate-950">{medicine.name}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{[medicine.strength, medicine.dosage_form, medicine.generic_name].filter(Boolean).join(" · ")}</span><span className="mt-3 flex items-end justify-between gap-2"><span className="text-base font-extrabold text-blue-700">{formatCurrency(medicine.selling_price)}</span><Badge variant={medicine.stock_status === "in_stock" ? "success" : medicine.stock_status === "low_stock" ? "warning" : "destructive"}>{medicine.available_quantity} in stock</Badge></span></span></button>)}
        </div>
      </section>

      <aside className="hidden w-[390px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:flex"><CartPanel cart={cart} subtotal={subtotal} total={total} discount={discount} onDiscount={setDiscount} onQuantity={setQuantity} onCheckout={() => setPaymentOpen(true)} /></aside>

      {cartOpen && <div className="fixed inset-0 z-[65] bg-white lg:hidden"><div className="flex h-full flex-col"><div className="flex h-16 items-center gap-3 border-b px-4"><Button variant="ghost" size="icon" onClick={() => setCartOpen(false)}><ChevronLeft /></Button><div><p className="font-bold">Current sale</p><p className="text-xs text-slate-500">{cartCount} units</p></div></div><CartPanel cart={cart} subtotal={subtotal} total={total} discount={discount} onDiscount={setDiscount} onQuantity={setQuantity} onCheckout={() => setPaymentOpen(true)} /></div></div>}

      <div className="no-print safe-bottom fixed inset-x-0 bottom-[61px] z-40 border-t border-slate-200 bg-white p-3 shadow-[0_-6px_20px_rgba(15,23,42,.08)] lg:hidden"><button onClick={() => setCartOpen(true)} className="flex h-14 w-full items-center justify-between rounded-2xl bg-blue-600 px-4 text-white"><span className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg bg-white/15"><ShoppingCart className="size-5" /></span><span className="text-left"><span className="block text-sm font-bold">View cart</span><span className="block text-[10px] text-blue-100">{cartCount} units</span></span></span><span className="text-lg font-extrabold">{formatCurrency(total)}</span></button></div>

      {paymentOpen && <div className="fixed inset-0 z-[80] bg-slate-950/45 p-0 backdrop-blur-sm sm:grid sm:place-items-center sm:p-4" onMouseDown={(e) => { if (e.currentTarget === e.target && !processing) setPaymentOpen(false); }}><div className="absolute inset-x-0 bottom-0 max-h-[94vh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:relative sm:max-w-lg sm:rounded-3xl sm:p-6"><div className="flex items-center justify-between"><div><p className="text-xs font-bold text-blue-700">Payment</p><h2 className="text-xl font-extrabold">Complete sale</h2></div><Button variant="ghost" size="icon" onClick={() => setPaymentOpen(false)} disabled={processing}><X /></Button></div><div className="mt-5 rounded-2xl bg-slate-950 p-5 text-white"><p className="text-xs text-slate-400">Amount due</p><p className="mt-1 text-3xl font-extrabold">{formatCurrency(total)}</p></div><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={() => setPaymentMethod("cash")} className={cn("flex h-12 items-center justify-center gap-2 rounded-xl border font-bold", paymentMethod === "cash" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200")}><ReceiptText /> Cash</button><button onClick={() => setPaymentMethod("card")} className={cn("flex h-12 items-center justify-center gap-2 rounded-xl border font-bold", paymentMethod === "card" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200")}><CreditCard /> Card</button></div>{paymentMethod === "cash" && <label className="mt-4 block"><span className="mb-1.5 block text-sm font-semibold">Cash received</span><Input inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} autoFocus placeholder="0.00" /><span className="mt-2 block text-sm text-slate-500">Change: <strong className="text-slate-900">{formatCurrency(change)}</strong></span></label>}<Button onClick={checkout} disabled={processing || !cart.length || (paymentMethod === "cash" && (Number(tendered) || 0) < total)} size="lg" className="mt-6 w-full">{processing ? <><LoaderCircle className="animate-spin" /> Processing securely…</> : <>Complete payment · {formatCurrency(total)}</>}</Button><p className="mt-3 text-center text-xs leading-5 text-slate-500">Stock, sale and payment are committed together. Closing this screen does not create a sale.</p></div></div>}
    </main>
  );
}

function CartPanel({ cart, subtotal, total, discount, onDiscount, onQuantity, onCheckout }: { cart: CartItem[]; subtotal: number; total: number; discount: string; onDiscount: (value: string) => void; onQuantity: (id: string, value: number) => void; onCheckout: () => void }) {
  return <><div className="flex items-center justify-between border-b p-4"><div><h2 className="font-extrabold">Current sale</h2><p className="text-xs text-slate-500">{cart.length} medicine{cart.length === 1 ? "" : "s"}</p></div><ShoppingCart className="text-blue-600" /></div><div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto p-3">{cart.length === 0 ? <div className="grid h-full min-h-48 place-items-center text-center"><div><ShoppingCart className="mx-auto size-10 text-slate-300" /><p className="mt-3 font-bold">Cart is empty</p><p className="mt-1 text-sm text-slate-500">Select a medicine to add it.</p></div></div> : cart.map((item) => <div key={item.id} className="rounded-xl border border-slate-100 p-3"><div className="flex justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{item.name} {item.strength}</p><p className="text-xs text-slate-500">{formatCurrency(item.selling_price)} / {item.base_unit}</p></div><button className="text-slate-400 hover:text-red-600" onClick={() => onQuantity(item.id, 0)} aria-label={`Remove ${item.name}`}><Trash2 className="size-4" /></button></div><div className="mt-3 flex items-center justify-between"><div className="flex items-center rounded-lg border"><button className="grid size-8 place-items-center" onClick={() => onQuantity(item.id, item.quantity - 1)}><Minus className="size-3.5" /></button><span className="w-9 text-center text-sm font-bold tabular-nums">{item.quantity}</span><button className="grid size-8 place-items-center" onClick={() => onQuantity(item.id, item.quantity + 1)}><Plus className="size-3.5" /></button></div><strong>{formatCurrency(item.selling_price * item.quantity)}</strong></div></div>)}</div><div className="border-t bg-slate-50 p-4"><label className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold text-slate-600">Discount (Rs.)</span><Input className="h-9 w-28 text-right" inputMode="decimal" value={discount} onChange={(e) => onDiscount(e.target.value)} /></label><div className="mt-3 space-y-2 text-sm"><div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div><div className="flex justify-between text-lg font-extrabold"><span>Total</span><span>{formatCurrency(total)}</span></div></div><Button size="lg" className="mt-4 w-full" onClick={onCheckout} disabled={!cart.length}><CreditCard /> Checkout</Button></div></>;
}
