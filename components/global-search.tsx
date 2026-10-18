"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Pill, ReceiptText, LoaderCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";

type SearchResult = { id: string; type: "medicine" | "invoice"; title: string; subtitle: string; meta?: string };

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (query.trim().length < 2) { setResults([]); setPending(false); setError(""); return; }
      setPending(true); setError("");
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!controller.signal.aborted) setResults(data);
      } catch { if (!controller.signal.aborted) { setResults([]); setError("Search could not load. Check your connection and try again."); } }
      finally { if (!controller.signal.aborted) setPending(false); }
    }, 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open, retry]);

  if (!open) return null;
  return (
    <Dialog label="Global search" onClose={onClose}>
        <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
          {pending ? <LoaderCircle className="size-5 animate-spin text-blue-600" /> : <Search className="size-5 text-slate-400" />}
          <Input autoFocus aria-label="Search medicines or invoices" value={query} onChange={(e) => { setQuery(e.target.value); setResults([]); setError(""); setPending(e.target.value.trim().length >= 2); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "Enter") { event.preventDefault(); resultsRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); } }} className="h-11 min-w-0 border-0 px-0 shadow-none focus:ring-0" placeholder="Medicine, barcode or invoice" />
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close search"><X className="size-5" /></Button>
        </div>
        <div ref={resultsRef} className="max-h-[60dvh] overflow-y-auto py-2">
          {query.trim().length < 2 && <p className="p-4 text-center text-sm text-slate-500">Search by medicine name, barcode or invoice number. Type at least two characters.</p>}
          {pending && <p role="status" className="p-4 text-sm text-slate-500">Searching...</p>}
          {error && <div role="alert" className="p-3 text-sm text-red-700">{error}<Button variant="ghost" onClick={() => setRetry((n) => n + 1)}>Try again</Button></div>}
          {query.trim().length >= 2 && !pending && !error && results.length === 0 && <p className="p-4 text-center text-sm text-slate-500">No matching medicines or invoices. Check the name or invoice number.</p>}
          {results.map((result) => (
            <button key={`${result.type}-${result.id}`} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-blue-50" onClick={() => { onClose(); router.push(result.type === "medicine" ? `/medicines/${result.id}` : `/sales/${result.id}`); }}>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-700">{result.type === "medicine" ? <Pill /> : <ReceiptText />}</span>
              <span className="min-w-0 flex-1"><span className="block break-words font-semibold text-slate-900">{result.title}</span><span className="block break-words text-xs text-slate-500">{result.subtitle}</span></span>
              {result.meta && <span className="text-sm font-bold text-slate-700">{result.type === "medicine" ? formatCurrency(result.meta) : result.meta}</span>}
            </button>
          ))}
        </div>
    </Dialog>
  );
}
