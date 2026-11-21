"use client";

import { useEffect, useRef, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { searchQuery } from "@/lib/live-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocalRecordSearch } from "@/components/ui/record-search-results";

export function LiveRouteForm({ action, className, children, localSearch }: {
  action: string;
  className: string;
  children: ReactNode;
  localSearch?: { commit: () => void; filters?: Record<string, string> };
}) {
  const router = useRouter();
  const context = useLocalRecordSearch();
  const local = localSearch ?? context;
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requested = useRef<string>(undefined);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function restore() {
      clearTimeout(timer.current);
      const field = formRef.current?.elements.namedItem("q");
      if (field instanceof HTMLInputElement) field.value = searchQuery(new URLSearchParams(window.location.search).get("q"));
    }
    window.addEventListener("popstate", restore);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("popstate", restore);
    };
  }, []);

  function submit(form: HTMLFormElement, delay: number) {
    clearTimeout(timer.current);
    const url = new URL(action, window.location.origin);
    for (const [key, raw] of new FormData(form)) {
      if (typeof raw !== "string") continue;
      const value = key === "q" ? searchQuery(raw) : raw;
      if (value) url.searchParams.set(key, value);
    }
    const href = url.pathname + url.search;
    function navigate() {
      const current = window.location.pathname + window.location.search;
      if (href === current && (!requested.current || requested.current === current)) return;
      if (pending && requested.current === href) return;
      requested.current = href;
      startTransition(() => router.replace(href, { scroll: false }));
    }
    if (delay) timer.current = setTimeout(navigate, delay);
    else navigate();
  }

  function canFilterLocally(form: HTMLFormElement) {
    if (!local) return false;
    if (!localSearch?.filters) return true;
    const data = new FormData(form);
    return Object.entries(localSearch.filters).every(([name, value]) => data.get(name) === value);
  }

  return (
    <form
      ref={formRef}
      action={action}
      className={className}
      aria-busy={pending}
      onChange={(event) => { if (!canFilterLocally(event.currentTarget)) submit(event.currentTarget, 160); }}
      onSubmit={(event) => { event.preventDefault(); if (local && canFilterLocally(event.currentTarget)) local.commit(); else submit(event.currentTarget, 0); }}
    >
      {children}
      {pending && <span role="status" className="sr-only">Searching…</span>}
    </form>
  );
}

export function HistorySearch({ action, query, label, filters = {} }: {
  action: string;
  query: string;
  label: string;
  filters?: Record<string, string>;
}) {
  const local = useLocalRecordSearch();
  return (
    <LiveRouteForm action={action} className="mb-3 mt-4 flex min-w-0 gap-2">
      {Object.entries(filters).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <Input aria-label={label} name="q" defaultValue={query} onChange={local ? (event) => local.changeQuery(event.target.value) : undefined} maxLength={100} placeholder={label} />
      <Button type="submit" variant="outline"><Search /> Search</Button>
    </LiveRouteForm>
  );
}
