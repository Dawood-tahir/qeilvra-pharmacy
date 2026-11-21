"use client";

import { useEffect, useMemo, useState } from "react";
import type { StockMedicine } from "@/lib/medicine-units";
import { loadMedicineCatalog, medicineSearchFields, rankMedicineMatches } from "@/lib/load-medicine-catalog";
import { searchQuery } from "@/lib/live-search";
import { useSearchRows } from "@/components/ui/use-live-search";

export function useMedicineSearch({ initialCatalog, limit, enabled = true }: {
  initialCatalog?: StockMedicine[];
  limit: number;
  enabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<{ version: number; rows?: StockMedicine[]; error?: boolean }>();
  const ready = version === 0 && initialCatalog !== undefined;
  const current = loaded?.version === version ? loaded : undefined;
  const fetched = Boolean(current);
  const rows = ready ? initialCatalog : current?.rows;
  const matches = useSearchRows(rows ?? EMPTY_CATALOG, medicineSearchFields, query);
  const term = searchQuery(query).toLowerCase();
  const results = useMemo(() => rankMedicineMatches(matches, term).slice(0, limit), [matches, limit, term]);

  useEffect(() => {
    if (!enabled || ready || fetched) return;
    const controller = new AbortController();
    void loadMedicineCatalog(async (offset, limit) => {
      const response = await fetch("/api/medicines/search?" + new URLSearchParams({ q: "", limit: String(limit), offset: String(offset) }), {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Medicine catalog could not be loaded");
      return await response.json() as StockMedicine[];
    }).then((rows) => {
      if (!controller.signal.aborted) setLoaded({ version, rows });
    }).catch(() => {
      if (!controller.signal.aborted) setLoaded({ version, error: true });
    });
    return () => controller.abort();
  }, [enabled, fetched, ready, version]);

  return {
    query,
    setQuery,
    results,
    loading: enabled && !ready && !current,
    error: current?.error ?? false,
    reload: () => setVersion((value) => value + 1),
  };
}

const EMPTY_CATALOG: StockMedicine[] = [];
