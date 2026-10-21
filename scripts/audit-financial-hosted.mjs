// Read-only production evidence collection. Never runs migrations, the archive
// worker, Storage writes, or transaction mutations. Financial evidence stays in
// the ignored .private directory; credentials and customer names are not logged.
import fs from "node:fs";
import assert from "node:assert/strict";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const reference = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
assert.ok(token, "A locally configured management credential is required.");
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
async function read(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${reference}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "begin isolation level repeatable read read only; set local statement_timeout='30s'; " + query + "; rollback;" }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Read-only audit failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return response.json();
}
const [metadata] = await read(`select jsonb_build_object(
 'archive',to_regclass('private.invoice_archive_settings') is not null,
 'ledger',to_regclass('private.invoice_item_ledger') is not null,
 'owner',(select ur.user_id from public.user_roles ur join public.profiles p on p.id=ur.user_id where ur.role='owner' and p.is_active limit 1),
 'functions',(select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'definition',pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'),
 'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid)) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
 'constraints',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid))) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','private'))
) metadata`);
const tables = ["sales", "sale_items", "sale_item_costs", "payments", "sale_returns", "return_items", "return_allocations", "purchases", "purchase_items", "medicine_batches", "medicines", "medicine_units", "medicine_costs", "stock_movements", "stock_receipts", "stock_dispositions", "expenses", "expense_categories", "pharmacy_settings"];
// Keep each row's original PostgreSQL JSON text, retaining arbitrary precision
// NUMERIC tokens for independent decimal reconciliation.
const available = await read("select table_name from information_schema.tables where table_schema='public'");
const names = new Set(available.map(row => row.table_name));
const snapshot = await read(`select jsonb_build_object('captured_at',now(),'today',(now() at time zone 'Asia/Karachi')::date,'tables',jsonb_build_object(${tables.filter(t => names.has(t)).map(t => quote(t) + `,(select coalesce(jsonb_agg(to_jsonb(t)::text order by to_jsonb(t)::text),'[]') from public.${t} t)`).join(",")})) evidence`);
const owner = metadata.metadata.owner;
assert.match(owner, /^[0-9a-f-]{36}$/);
const reports = await read(`set local role authenticated; set local request.jwt.claim.sub=${quote(owner)};
 select jsonb_build_object('today',public.owner_financial_analytics((now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date,'hour',true),
 'month',public.owner_financial_analytics(date_trunc('month',now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date,'day',true),
 'legacy',public.owner_dashboard_metrics('1900-01-01',current_date),
 'breakdowns',public.owner_report_breakdowns(current_date-365,current_date)) reports`);
const scopedReports = await read(`set local role authenticated; set local request.jwt.claim.sub=${quote(owner)};
 with clock as (select (now() at time zone 'Asia/Karachi')::date today), scopes as (
 select 'today' label,today first,today last from clock union all
 select 'yesterday',today-1,today-1 from clock union all
 select 'week',date_trunc('week',today)::date,today from clock union all
 select 'month',date_trunc('month',today)::date,today from clock union all
 select 'year',date_trunc('year',today)::date,today from clock union all
 select 'annual',today-365,today from clock union all
 select 'day-'||d::date,d::date,d::date from clock cross join lateral generate_series(today-7,today,interval '1 day') d
 ) select jsonb_build_object('periods',(select jsonb_agg(jsonb_build_object('label',label,'analytics',public.owner_financial_analytics(first,last,'day',true),'legacy',public.owner_dashboard_metrics(first,last),'trend',(select jsonb_agg(to_jsonb(t)) from public.owner_sales_trend(first,last) t),'breakdowns',public.owner_report_breakdowns(first,last))) from scopes),
 'inventory',(select jsonb_agg(i) from public.inventory_search('',50,0,'all','name') i),
 'supplier_summary_installed',${metadata.metadata.functions.some(f => f.name === "public.supplier_purchase_summary")},
 'suppliers',${metadata.metadata.functions.some(f => f.name === "public.supplier_purchase_summary") ? "(select jsonb_object_agg(supplier_id::text,public.supplier_purchase_summary(supplier_id,true)) from (select distinct supplier_id from public.purchases where supplier_id is not null) s)" : "null"}) scoped`);
let archiveSettings = null;
if (metadata.metadata.archive) archiveSettings = await read("select to_jsonb(s) settings from private.invoice_archive_settings s");
fs.mkdirSync(".private", { recursive: true });
const evidencePath = ".private/financial-audit-evidence.json";
const previous = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, "utf8")) : null;
const sameRowsAsPreviousCapture = previous ? JSON.stringify(previous.snapshot.tables) === JSON.stringify(snapshot[0].evidence.tables) : null;
fs.writeFileSync(evidencePath, JSON.stringify({ metadata: metadata.metadata, snapshot: snapshot[0].evidence, reports, scopedReports, archiveSettings, sameRowsAsPreviousCapture }, null, 2));
console.log(JSON.stringify({ capturedAt: snapshot[0].evidence.captured_at, counts: Object.fromEntries(Object.entries(snapshot[0].evidence.tables).map(([name, rows]) => [name, rows.length])), archiveInstalled: metadata.metadata.archive, ledgerInstalled: metadata.metadata.ledger, archiveSettings, sameRowsAsPreviousCapture, month: reports.find(r => r.reports)?.reports.month.metrics }, null, 2));
