"use client";

import { useEffect, useMemo, useState } from "react";
import { searchQuery } from "@/lib/live-search";
import { pageNumber } from "@/lib/pagination";

export function useSearchRows<T>(rows: readonly T[], fields: (row: T) => readonly (string | null | undefined)[], query: string) {
  const index = useMemo(() => rows.map((row) => fields(row).map((value) => value?.toLowerCase())), [rows, fields]);
  const term = searchQuery(query).toLowerCase();
  return useMemo(() => term ? rows.filter((_, i) => index[i].some((value) => value?.includes(term))) : rows, [rows, index, term]);
}

export function useSearchView(initialQuery: string, initialPage: number) {
  const [query, setQuery] = useState(initialQuery);
  const [page, setPage] = useState(initialPage);
  const [source, setSource] = useState({ query: initialQuery, page: initialPage });
  if (source.query !== initialQuery || source.page !== initialPage) {
    setSource({ query: initialQuery, page: initialPage });
    setQuery(initialQuery);
    setPage(initialPage);
  }

  useEffect(() => {
    function restore() {
      const params = new URLSearchParams(window.location.search);
      setQuery(searchQuery(params.get("q")));
      setPage(pageNumber(params.get("page") ?? undefined));
    }
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  function changeQuery(value: string) {
    setQuery(value);
    setPage(1);
  }

  function navigate(nextPage: number, value = query) {
    setQuery(value);
    setPage(nextPage);
    const url = new URL(window.location.href);
    const term = searchQuery(value);
    if (term) url.searchParams.set("q", term);
    else url.searchParams.delete("q");
    if (nextPage > 1) url.searchParams.set("page", String(nextPage));
    else url.searchParams.delete("page");
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
  }

  return { query, page, changeQuery, navigate };
}
