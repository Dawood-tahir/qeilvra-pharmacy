"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export type SupplierOption = { id: string; name: string };

// The selected value is always a saved ID. Typing a name never creates a supplier.
export function SupplierSelect({ suppliers, value, onChange, label = "Supplier", required = false, disabled = false }: {
  suppliers: SupplierOption[]; value: string; onChange: (id: string) => void;
  label?: string; required?: boolean; disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const selected = suppliers.find((supplier) => supplier.id === value);
  const matches = suppliers.filter((supplier) => supplier.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  function choose(supplier: SupplierOption) { onChange(supplier.id); setOpen(false); setQuery(""); input.current?.focus(); }
  return <div className="relative min-w-0" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(""); }
  }}>
    <label htmlFor={id} className="mb-2 block text-sm font-semibold">{label}{required ? " *" : " (optional)"}</label>
    {!suppliers.length ? <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><p>No suppliers saved yet. Add one from Suppliers.</p><Link className="mt-1 inline-flex min-h-11 items-center font-semibold text-blue-700" href="/suppliers">Open Suppliers</Link><p className="text-xs">Only active suppliers are available here.</p></div> : <>
      <div className="relative"><Search aria-hidden="true" className="absolute left-3 top-3.5 size-4 text-slate-400" /><Input ref={input} id={id} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={open} aria-controls={id + "-options"} aria-activedescendant={open && matches[active] ? id + "-option-" + active : undefined} aria-required={required} disabled={disabled} className="pl-10 pr-10" placeholder="Search saved suppliers" value={open ? query : selected?.name ?? ""}
        onFocus={() => { if (!disabled) { setOpen(true); setQuery(""); setActive(0); } }}
        onClick={() => { if (!open) { setOpen(true); setQuery(""); setActive(0); } }}
        onChange={(event) => { setOpen(true); setQuery(event.target.value); setActive(0); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive((index) => open ? Math.max(0, Math.min(matches.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))) : 0); }
          if (event.key === "Enter" && open) { event.preventDefault(); if (matches[active]) choose(matches[active]); }
          if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(""); }
        }} /><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3.5 size-4 text-slate-400" /></div>
      {open && <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg"><ul ref={list} id={id + "-options"} role="listbox" aria-label="Saved suppliers" className="max-h-60 overflow-y-auto p-1">{matches.map((supplier, index) => <li key={supplier.id} id={id + "-option-" + index} role="option" aria-selected={value === supplier.id} className={index === active ? "rounded-lg bg-blue-50" : ""}><button type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(supplier)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-blue-50"><span className="break-words">{supplier.name}</span>{value === supplier.id && <Check className="size-4 shrink-0 text-blue-700" />}</button></li>)}</ul>{!matches.length && <p role="status" className="p-3 text-sm text-slate-500">No saved supplier matches. Try another name.</p>}</div>}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-xs text-slate-500"><span>{selected ? "Selected: " + selected.name : required ? "Choose a saved supplier to continue." : "Choose a result, or leave blank if the supplier is not recorded."}</span>{selected && !required && <button type="button" disabled={disabled} className="min-h-11 font-semibold text-blue-700" onClick={() => { onChange(""); setQuery(""); setOpen(false); }}>Clear supplier</button>}</div>
    </>}
  </div>;
}
