-- Run only in the disposable local database, after business contract fixtures.
create or replace function public.test_forbidden(statement text,label text) returns void language plpgsql as $$
begin
 begin execute statement; exception when insufficient_privilege then raise notice 'PASS: %',label; return; end;
 raise exception 'FAIL: % did not raise insufficient_privilege',label;
end $$;

reset role;
select public.test_assert(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relname<>'test_ids' and not c.relrowsecurity),'every business table has RLS');
select public.test_assert(not has_function_privilege('anon','public.inventory_search(text,integer,integer,text,text)','execute'),'anonymous inventory RPC is revoked');
select public.test_assert(not has_function_privilege('authenticated','private.apply_sale_return(uuid,boolean,jsonb,text,public.payment_method)','execute'),'internal refund allocator remains inaccessible');
select public.test_assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('private','public') and p.prosecdef and p.proname not like 'test_%'
 and not coalesce(p.proconfig @> array['search_path=""'],false)),'definer functions use an empty search_path');

begin;
update public.profiles set is_active=false where id in ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.test_assert(public.is_active_staff() is false,'inactive staff predicate returns false, never SQL NULL');
select public.test_forbidden($q$select * from public.inventory_search()$q$,'inactive staff cannot bypass inventory guard');
select public.test_forbidden($q$select * from public.search_sellable_medicines()$q$,'inactive staff cannot bypass legacy search guard');
select public.test_forbidden($q$select * from public.inventory_alerts()$q$,'inactive staff cannot read pharmacy alerts');
select public.test_forbidden($q$select * from public.receipt_settings()$q$,'inactive staff cannot read receipt settings');
select public.test_forbidden($q$select public.salesperson_dashboard()$q$,'inactive staff cannot bypass salesperson role comparison');
select public.test_assert((select count(*)=0 from public.sale_returns),'inactive cashier cannot read historical refunds through RLS');
select public.test_forbidden($q$select public.owner_expense_total(current_date,current_date)$q$,'inactive staff cannot read expense totals');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select public.test_forbidden($q$select * from public.inventory_search()$q$,'inactive Owner cannot read inventory');
select public.test_forbidden($q$select public.owner_dashboard_metrics(current_date,current_date)$q$,'inactive Owner cannot read financial metrics');
select set_config('request.jwt.claim.sub','',true);
select public.test_forbidden($q$select * from public.inventory_search()$q$,'role without a user cannot read inventory');
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000099',true);
select public.test_assert(public.is_active_staff() is false,'an authenticated identity without a staff profile is not staff');
select public.test_forbidden($q$select * from public.inventory_search()$q$,'an unassigned signup identity cannot read inventory');
select public.test_forbidden($q$select * from public.receipt_settings()$q$,'an unassigned signup identity cannot read receipt settings');
rollback;

set role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',false);
select public.test_forbidden($q$select public.owner_expense_total(current_date,current_date)$q$,'Salesperson cannot read expense totals');
select public.test_assert((select count(*)=0 from public.medicine_costs),'Salesperson cannot read purchase cost rows');
select public.test_assert((select count(*)=0 from public.medicine_batches),'Salesperson cannot read batch costs');
select public.test_forbidden($q$update public.profiles set is_active=true where id=auth.uid()$q$,'Salesperson cannot reactivate own account');
select public.test_forbidden($q$insert into public.payments(sale_id,kind,method,amount,received_by) values(gen_random_uuid(),'refund','cash',1,auth.uid())$q$,'direct forged refund payments are denied');

reset role;
begin;
insert into public.expense_categories(id,name) values ('fa000000-0000-4000-8000-000000000001','Audit expense category');
insert into public.expenses(category_id,amount,expense_date,description,payment_method,created_by)
 select 'fa000000-0000-4000-8000-000000000001',0.01,'2090-01-01','Audit expense '||g,'cash','10000000-0000-0000-0000-000000000001' from generate_series(1,251)g;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select public.test_assert(public.owner_expense_total('2090-01-01','2090-01-01')=2.51,'expense total includes all 251 rows beyond the former 200-row cap');
rollback;
reset role;
