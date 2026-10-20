-- Disposable contract database only; every fixture is rolled back.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
insert into public.suppliers(id,name,created_by) values
 ('51000000-0000-4000-8000-000000000015','Summary contract supplier',auth.uid()),
 ('51000000-0000-4000-8000-000000000016','Empty summary supplier',auth.uid());
-- Fixture setup runs as the local database owner; app writes remain RPC-only.
reset role;
insert into public.purchases(purchase_number,supplier_id,invoice_date,status,subtotal,discount,total,posted_at,created_by)
select 'SUMMARY-' || n, '51000000-0000-4000-8000-000000000015', current_date - n,
 'posted', 10.03, 0.01, 10.02, now(), auth.uid() from generate_series(1,1005) n;
insert into public.purchase_items(purchase_id,medicine_id,batch_number,expiry_date,quantity,unit_cost)
select p.id, (select id from public.test_ids where label='syrup'), p.purchase_number, current_date+30, 1, 10.03
from public.purchases p where p.supplier_id='51000000-0000-4000-8000-000000000015';
insert into public.purchases(purchase_number,supplier_id,status,subtotal,total,created_by) values
 ('SUMMARY-DRAFT','51000000-0000-4000-8000-000000000015','draft',999,999,auth.uid()),
 ('SUMMARY-CANCELLED','51000000-0000-4000-8000-000000000015','cancelled',999,999,auth.uid());
set local role authenticated;
do $$ declare v jsonb; begin
  v := public.supplier_purchase_summary('51000000-0000-4000-8000-000000000015');
  perform public.test_assert((v->>'total')::numeric=10070.10 and (v->>'deliveries')::int=1005, 'all posted invoices included past response cap, discounted header totals preserved');
  perform public.test_assert((v->>'medicineCount')::int=1 and (v->>'drafts')::int=1, 'repeated medicines deduplicated; drafts separate; cancelled excluded');
  perform public.test_assert((v->>'lastPurchase')::date=current_date-1, 'last posted purchase preserved');
  perform public.test_assert((v->'lastPurchases'->>((select id from public.test_ids where label='syrup')::text))::date=current_date-1, 'last purchase per medicine preserved');
  v := public.supplier_purchase_summary('51000000-0000-4000-8000-000000000015', false);
  perform public.test_assert(v->'lastPurchases'='{}'::jsonb and (v->>'medicineCount')::int=1, 'history tabs omit medicine map without losing distinct count');
  v := public.supplier_purchase_summary('51000000-0000-4000-8000-000000000016');
  perform public.test_assert((v->>'total')::numeric=0 and v->'lastPurchase'='null'::jsonb and v->'lastPurchases'='{}'::jsonb, 'empty supplier has accurate zeros');
  perform public.test_assert((select not prosecdef from pg_proc where oid='public.supplier_purchase_summary(uuid,boolean)'::regprocedure), 'summary executes under caller RLS');
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
do $$ begin
  begin
    perform public.supplier_purchase_summary('51000000-0000-4000-8000-000000000015');
    raise exception 'Salesperson summary access must fail';
  exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
  begin
    perform public.supplier_purchase_summary('51000000-0000-4000-8000-000000000015');
    raise exception 'Anonymous summary access must fail';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
