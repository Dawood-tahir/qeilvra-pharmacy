"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Bell, Boxes, ContactRound, LoaderCircle, Pill, ReceiptText, RotateCcw, ScrollText,
  Search, Truck, Users, WalletCards, X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { GlobalSearchResult, GlobalSearchType } from "@/lib/global-search";
import { matchesSearch, NO_SEARCH_MATCHES, searchQuery } from "@/lib/live-search";
import { safeAppPath } from "@/lib/navigation";

const resultTypes = {
  medicine: { label: "Medicine", icon: Pill },
  invoice: { label: "Invoice", icon: ReceiptText },
  return: { label: "Return", icon: RotateCcw },
  purchase: { label: "Purchase", icon: Truck },
  supplier: { label: "Supplier", icon: ContactRound },
  staff: { label: "Staff", icon: Users },
  batch: { label: "Stock batch", icon: Boxes },
  expense: { label: "Expense", icon: WalletCards },
  notification: { label: "Notification", icon: Bell },
  audit: { label: "Audit event", icon: ScrollText },
} satisfies Record<GlobalSearchType, { label: string; icon: typeof Pill }>;

type SearchSnapshot = { term: string; rows: GlobalSearchResult[]; complete: boolean };

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [snapshots, setSnapshots] = useState<SearchSnapshot[]>([]);
  const [failedTerm, setFailedTerm] = useState<string>();
  const term = searchQuery(query).toLowerCase();
  const exact = snapshots.find((entry) => entry.term === term);
  const complete = snapshots.find((entry) => entry.complete && term.includes(entry.term));
  const cached = complete ?? snapshots[0];
  const results = exact?.rows ?? cached?.rows.filter((row) => matchesSearch(row.fields, term)) ?? [];
  const error = !exact && !complete && failedTerm === term;
  const pending = open && !exact && !complete && !error;
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const resultsId = useId();
  const router = useRouter();

  useEffect(() => {
    function showSearch(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", showSearch);
    return () => window.removeEventListener("keydown", showSearch);
  }, []);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !searchRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/search?" + new URLSearchParams({ q: term }), {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Search failed");
        const rows: GlobalSearchResult[] = await response.json();
        if (!controller.signal.aborted) {
          const next = { term, rows, complete: response.headers.get("X-Search-Complete") === "true" };
          setSnapshots((previous) => [next, ...previous.filter((item) => item.term !== term).slice(0, 29)]);
        }
      } catch {
        if (!controller.signal.aborted) setFailedTerm(term);
      }
    }, term.length > 1 ? 120 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [pending, term]);

  function choose(result: GlobalSearchResult) {
    setOpen(false);
    setQuery("");
    setSnapshots([]);
    setFailedTerm(undefined);
    router.push(safeAppPath(result.href));
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      inputRef.current?.focus();
      setOpen(false);
      return;
    }
    if (event.key === "Enter" && event.target === inputRef.current && open && results[0]) {
      event.preventDefault();
      choose(results[0]);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const choices = Array.from(resultsRef.current?.querySelectorAll<HTMLButtonElement>("[data-search-result]") ?? []);
    if (!choices.length) return;
    const current = choices.findIndex((entry) => entry === event.target);
    const next = current + (event.key === "ArrowDown" ? 1 : -1);
    event.preventDefault();
    if (next < 0) inputRef.current?.focus();
    else choices[Math.min(next, choices.length - 1)]?.focus();
  }

  return (
    <div
      ref={searchRef}
      role="search"
      className="relative min-w-0 max-w-xl flex-1"
      onKeyDown={handleKeys}
      onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    >
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
      <Input
        ref={inputRef}
        aria-label="Global search"
        aria-controls={open ? resultsId : undefined}
        autoComplete="off"
        maxLength={100}
        value={query}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setFailedTerm(undefined); setOpen(true); }}
        placeholder="Search records"
        className={"q-shell-search h-11 border-blue-100 bg-white/75 pl-9 " + (query ? "pr-10" : "pr-2 sm:pr-16")}
      />
      {query ? (
        <Button type="button" variant="ghost" size="icon" aria-label="Clear global search" className="absolute right-1 top-1 size-9" onClick={() => {
          setQuery("");
          setFailedTerm(undefined);
          inputRef.current?.focus();
        }}><X /></Button>
      ) : (
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border bg-white px-2 py-0.5 text-[10px] text-slate-500 sm:block">Ctrl K</kbd>
      )}
      {open && (
        <div id={resultsId} ref={resultsRef} className="fixed inset-x-2 top-16 z-50 max-h-[60dvh] overflow-y-auto rounded-xl border border-blue-100 bg-white p-1 shadow-lg sm:absolute sm:inset-x-0 sm:top-[calc(100%+0.5rem)]">
          {pending && <p role="status" className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin text-blue-600" />Searching…</p>}
          {error && <div role="alert" className="p-3 text-sm text-red-700">Search could not load. Check your connection and try again.<Button type="button" variant="ghost" onClick={() => setFailedTerm(undefined)}>Try again</Button></div>}
          {!pending && !error && results.length === 0 && <p role="status" className="p-4 text-center text-sm text-slate-500">{NO_SEARCH_MATCHES}</p>}
          {results.map((result) => {
            const { label, icon: Icon } = resultTypes[result.type];
            return (
              <button key={result.type + ":" + result.id} type="button" data-search-result className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-blue-50 focus-visible:bg-blue-50" onClick={() => choose(result)}>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-700"><Icon className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-semibold text-slate-900">{result.title}</span>
                  <span className="block break-words text-xs text-slate-500">{label}{result.subtitle ? " · " + result.subtitle : ""}</span>
                </span>
                {result.meta && <span className="text-sm font-bold text-slate-700">{result.meta}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
