"use client";

import { createContext, Fragment, useContext, type ReactNode } from "react";
import { useSearchRows, useSearchView } from "@/components/ui/use-live-search";
import { NO_SEARCH_MATCHES } from "@/lib/live-search";

type Fields = readonly (string | null | undefined)[];
type SearchRow = { id: string; fields: Fields; content: ReactNode; compact?: ReactNode };
type SearchContext = { query: string; changeQuery: (value: string) => void; commit: () => void };
const LocalSearch = createContext<SearchContext | null>(null);
const rowFields = (row: SearchRow) => row.fields;

export function RecordSearchScope({ complete, query = "", children }: { complete: boolean; query?: string; children: ReactNode }) {
  const view = useSearchView(query, 1);
  return (
    <LocalSearch.Provider value={complete ? { query: view.query, changeQuery: view.changeQuery, commit: () => view.navigate(1) } : null}>
      {children}
    </LocalSearch.Provider>
  );
}

export function useLocalRecordSearch() {
  return useContext(LocalSearch);
}

export function RecordSearchResults({ rows, empty, headings }: { rows: SearchRow[]; empty: ReactNode; headings?: ReactNode }) {
  const local = useLocalRecordSearch();
  const matches = useSearchRows(rows, rowFields, local?.query ?? "");
  if (!matches.length) return local?.query.trim()
    ? <p role="status" className="p-8 text-center text-sm text-slate-500">{NO_SEARCH_MATCHES}</p>
    : empty;
  if (headings) return <>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-left text-sm">
        {headings}
        <tbody>{matches.map(({ id, content }) => <Fragment key={id}>{content}</Fragment>)}</tbody>
      </table>
    </div>
    <div className="divide-y divide-slate-100 md:hidden">{matches.map(({ id, compact }) => <Fragment key={id}>{compact}</Fragment>)}</div>
  </>;
  return <div className="divide-y divide-slate-100">{matches.map(({ id, content }) => <Fragment key={id}>{content}</Fragment>)}</div>;
}
