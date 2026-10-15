"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Pill, ReceiptText, LoaderCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";

type SearchResult = { id: string; type: "medicine" | "invoice"; title: string; subtitle: string; meta?: string };

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (query.trim().length < 2) { setResults([]); return; }
      startTransition(async () => {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        if (response.ok) setResults(await response.json());
      });
    }, 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-slate-950/35 p-3 backdrop-blur-sm sm:p-10" role="dialog" aria-modal="true" aria-label="Global search" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}>
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-white/50 bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-100 p-3">
          {pending ? <LoaderCircle className="size-5 animate-spin text-blue-600" /> : <Search className="size-5 text-slate-400" />}
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} className="h-11 border-0 px-0 shadow-none focus:ring-0" placeholder="Search medicine, SKU, barcode or invoice…" />
          <button onClick={onClose} className="grid size-9 place-items-center rounded-lg hover:bg-slate-100" aria-label="Close search"><X className="size-5" /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {query.length < 2 && <p className="p-8 text-center text-sm text-slate-500">Type at least two characters. Press Esc to close.</p>}
          {query.length >= 2 && !pending && results.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No matching medicines or invoices found.</p>}
          {results.map((result) => (
            <button key={`${result.type}-${result.id}`} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-blue-50" onClick={() => { onClose(); router.push(result.type === "medicine" ? `/medicines/${result.id}` : `/sales/${result.id}`); }}>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-700">{result.type === "medicine" ? <Pill /> : <ReceiptText />}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-slate-900">{result.title}</span><span className="block truncate text-xs text-slate-500">{result.subtitle}</span></span>
              {result.meta && <span className="text-sm font-bold text-slate-700">{result.type === "medicine" ? formatCurrency(result.meta) : result.meta}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
