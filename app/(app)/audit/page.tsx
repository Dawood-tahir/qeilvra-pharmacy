import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export default async function AuditPage() {
  await requireOwner();
  const supabase = await createClient();
  const { data } = await supabase.from("audit_logs").select("id,action,entity_type,entity_id,old_data,new_data,metadata,created_at,profiles(full_name)").order("created_at", { ascending: false }).limit(200);
  const entries = data ?? [];
  return <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8"><p className="text-sm font-semibold text-blue-700">Owner oversight</p><h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">Audit log</h1><p className="mt-1 text-sm text-slate-500">Append-only history for sensitive price, role, stock, refund, expense, settings and checkout events.</p><Card className="mt-5"><CardContent className="p-0">{entries.length === 0 ? <EmptyState icon={ScrollText} title="No audit events" description="Sensitive changes will be recorded here." /> : <div className="divide-y divide-slate-100">{entries.map((entry) => <details key={entry.id} className="group p-4"><summary className="flex cursor-pointer list-none items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700"><ScrollText className="size-5" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="capitalize">{entry.action.replaceAll("_", " ")}</strong><Badge variant="neutral">{entry.entity_type}</Badge></span><span className="block truncate text-xs text-slate-500">{(entry.profiles as unknown as { full_name?: string } | null)?.full_name ?? "System"} · {formatDateTime(entry.created_at)} · {entry.entity_id}</span></span></summary><pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify({ before: entry.old_data, after: entry.new_data, metadata: entry.metadata }, null, 2)}</pre></details>)}</div>}</CardContent></Card></main>;
}
