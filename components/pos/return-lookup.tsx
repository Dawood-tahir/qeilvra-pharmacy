"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { ReturnRequest } from "@/components/sales/return-request";
import { ReviewReturn } from "@/components/returns/review-return";
import type { AppRole } from "@/lib/auth";

type Invoice = {
  id: string; invoice_number: string; subtotal: number; net_total: number;
  sale_items: { id: string; medicine_name: string; quantity: number; unit_label: string; unit_price: number; net_line_total: number | null }[];
  sale_returns: { id: string; status: string; return_items: { id: string; sale_item_id: string; quantity: number; approved_quantity: number | null }[] }[];
};

export function ReturnLookup({ role, onClose }: { role: AppRole; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function find() {
    setLoading(true); setError(""); setSelected(null); setInvoices([]);
    try {
      const response = await fetch("/api/returns/invoice?q=" + encodeURIComponent(query.trim()), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setInvoices(data); setSelected(data.length === 1 ? data[0].id : null);
      if (!data.length) setError("No accessible invoice found. Check the invoice number.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not find the invoice."); }
    finally { setLoading(false); }
  }
  const invoice = invoices.find((entry) => entry.id === selected);
  return <Dialog label="Return / Refund" busy={busy || loading} onClose={onClose}>
    <div className="flex items-center justify-between"><h2 className="text-xl font-extrabold">Return / Refund</h2><Button aria-label="Close returns" size="icon" variant="ghost" disabled={busy || loading} onClick={onClose}><X /></Button></div>
    <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); void find(); }}><Input aria-label="Invoice number" autoFocus required minLength={3} maxLength={80} value={query} disabled={busy || loading} onChange={(e) => setQuery(e.target.value)} placeholder="Search or scan invoice number" /><Button disabled={busy || loading}><Search />{loading ? "Finding..." : "Find"}</Button></form>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {!invoice && invoices.map((entry) => <Button key={entry.id} variant="outline" className="mt-2 w-full" onClick={() => setSelected(entry.id)}>{entry.invoice_number}</Button>)}
    {invoice && <div className="mt-4">
      <ReturnRequest key={invoice.id} embedded saleId={invoice.id} invoiceNumber={invoice.invoice_number} onBusy={setBusy} onSubmitted={() => void find()} items={invoice.sale_items.map((item) => {
        const returns = invoice.sale_returns.flatMap((entry) => entry.return_items.filter((line) => line.sale_item_id === item.id).map((line) => ({ ...line, status: entry.status })));
        const approved = returns.filter((entry) => entry.status === "approved").reduce((sum, entry) => sum + Number(entry.approved_quantity ?? 0), 0);
        const pending = returns.filter((entry) => entry.status === "requested").reduce((sum, entry) => sum + Number(entry.quantity), 0);
        return { ...item, quantity: Number(item.quantity), unit_price: Number(item.unit_price), net_line_total: Number(item.net_line_total ?? Number(item.unit_price) * Number(item.quantity) * (invoice.subtotal > 0 ? invoice.net_total / invoice.subtotal : 0)), approved, available: Math.max(0, Number(item.quantity) - approved - pending) };
      })} />
      {role === "owner" && invoice.sale_returns.filter((entry) => entry.status === "requested").map((entry) => <div key={entry.id} className="mt-3 flex items-center justify-between rounded-xl bg-blue-50 p-3 text-sm"><span>Pending Owner approval</span><ReviewReturn returnId={entry.id} invoiceNumber={invoice.invoice_number} onReviewed={() => void find()} items={entry.return_items.map((line) => ({ id: line.id, quantity: Number(line.quantity), medicine: invoice.sale_items.find((item) => item.id === line.sale_item_id)?.medicine_name ?? "Medicine" }))} /></div>)}
    </div>}
    <Link href="/returns" className="mt-4 block text-center text-sm font-semibold text-blue-700">View all return requests</Link>
  </Dialog>;
}
