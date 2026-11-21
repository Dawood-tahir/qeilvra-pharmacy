import { RecordSearchResults, RecordSearchScope } from "@/components/ui/record-search-results";
import { HistorySearch } from "@/components/ui/live-route-form";
import { NO_SEARCH_MATCHES, searchQuery, textSearchFilter } from "@/lib/live-search";
import { Pagination } from "@/components/ui/pagination";
import { HISTORY_PAGE_SIZE, pageNumber } from "@/lib/pagination";
import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export default async function AuditPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ page?: string; q?: string | string[] }> } = {}) {
  const params = await searchParams;
  const page = pageNumber(params.page);
  const query = searchQuery(params.q);
  await requireOwner();
  const supabase = await createClient();
  let request = supabase.from("audit_logs").select("id,action,entity_type,entity_id,old_data,new_data,metadata,created_at,profiles(full_name)").order("created_at", { ascending: false }).order("id", { ascending: false });
  if (query) request = request.or(textSearchFilter(query, "action", "entity_type"));
  const { data, error } = await request.range((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);
  if (error) throw new Error("Audit could not be loaded. Please try again.");
  const entries = (data ?? []).slice(0, HISTORY_PAGE_SIZE);
  return <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8"><p className="text-sm font-semibold text-blue-700">Owner oversight</p><h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">Audit log</h1><p className="mt-1 text-sm text-slate-500">Append-only history for sensitive price, role, stock, refund, expense, settings and checkout events.</p><RecordSearchScope complete={page === 1 && !query && (data?.length ?? 0) <= HISTORY_PAGE_SIZE} query={query}><HistorySearch action="/audit" query={query} label="Search audit action or record type" /><Card className="mt-5"><CardContent className="p-0"><RecordSearchResults empty={<EmptyState icon={ScrollText} title={query ? NO_SEARCH_MATCHES : "No audit events"} description="Sensitive changes will be recorded here." />} rows={entries.map((entry) => ({ id: entry.id, fields: [entry.action, entry.entity_type], content: <details key={entry.id} className="group p-4"><summary className="flex cursor-pointer list-none items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700"><ScrollText className="size-5" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="capitalize">{entry.action.replaceAll("_", " ")}</strong><Badge variant="neutral">{entry.entity_type}</Badge></span><span className="block truncate text-xs text-slate-500">{(entry.profiles as unknown as { full_name?: string } | null)?.full_name ?? "System"} · {formatDateTime(entry.created_at)} · {entry.entity_id}</span></span></summary><pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify({ before: entry.old_data, after: entry.new_data, metadata: entry.metadata }, null, 2)}</pre></details> }))} /></CardContent></Card><Pagination pathname="/audit" page={page} hasMore={(data?.length ?? 0) > HISTORY_PAGE_SIZE} query={{ q: query }} /></RecordSearchScope></main>;
}
