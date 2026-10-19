begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
create temporary table financial_before as select
 public.owner_financial_analytics((now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date,'hour') today,
 public.owner_financial_analytics((now() at time zone 'Asia/Karachi')::date-1,(now() at time zone 'Asia/Karachi')::date-1) yesterday;
insert into public.test_ids select 'finance-med',(public.save_guided_medicine(null,
 '{"name":"Financial analytics fixture","dosage_form":"Tablet","barcode":"FINANCE-ONLY","tablets_per_strip":10,"strips_per_box":10,"units":[{"unit_key":"base","selling_price":12},{"unit_key":"strip","selling_price":100},{"unit_key":"box","selling_price":900}]}',
 '{"unit_key":"box","quantity":5,"batch_number":"FINANCE-ONLY","expiry_date":"2099-12-25","total_cost":1000}',gen_random_uuid())->>'id')::uuid;
insert into public.test_ids select 'finance-sale',sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='finance-med'),'unit_key','strip','quantity',2,'line_discount',10)),'cash',220,10,gen_random_uuid(),null,null,30,'Delivery');
reset role;
update public.sales set completed_at=(((now() at time zone 'Asia/Karachi')::date-1)::timestamp+interval '12 hours') at time zone 'Asia/Karachi' where id=(select id from public.test_ids where label='finance-sale');
set local role authenticated;
select public.complete_sale_return((select id from public.test_ids where label='finance-sale'),(select jsonb_build_array(jsonb_build_object('sale_item_id',id,'quantity',1,'in_base_units',true,'restockable',true)) from public.sale_items where sale_id=(select id from public.test_ids where label='finance-sale')),'Resale tablet from earlier sale',gen_random_uuid());
select public.complete_sale_return((select id from public.test_ids where label='finance-sale'),(select jsonb_build_array(jsonb_build_object('sale_item_id',id,'quantity',1,'in_base_units',true,'restockable',false)) from public.sale_items where sale_id=(select id from public.test_ids where label='finance-sale')),'Opened tablet from earlier sale',gen_random_uuid());
insert into public.expense_categories(id,name) values('f1000000-0000-4000-8000-000000000001','Financial Test Utilities');
insert into public.expenses(category_id,amount,expense_date,description,created_by) values('f1000000-0000-4000-8000-000000000001',50,(now() at time zone 'Asia/Karachi')::date,'Synthetic operating expense',auth.uid());
do $$
declare v_today date:=(now() at time zone 'Asia/Karachi')::date; v_now jsonb; v_old jsonb; v_base jsonb; v_yesterday jsonb; v_period jsonb;
begin
 v_now:=public.owner_financial_analytics(v_today,v_today,'hour',true);
 v_old:=public.owner_financial_analytics(v_today-1,v_today-1);
 select today->'metrics',yesterday->'metrics' into v_base,v_yesterday from financial_before;
 perform public.test_assert((v_now->'metrics'->>'revenue')::numeric=(v_base->>'revenue')::numeric-18,'today includes refunds of earlier sales, exactly once');
 perform public.test_assert((v_now->'metrics'->>'cogs')::numeric=(v_base->>'cogs')::numeric-2,'only resale stock reverses original medicine cost');
 perform public.test_assert((v_now->'metrics'->>'gross_profit')::numeric=(v_base->>'gross_profit')::numeric-16,'gross profit accounts for nonresale returns without reversing their cost');
 perform public.test_assert((v_now->'metrics'->>'net_operating_profit')::numeric=(v_base->>'net_operating_profit')::numeric-66,'operating expense is subtracted exactly once and negative profit is retained');
 perform public.test_assert((v_now->'metrics'->>'extra_charge_revenue')::numeric=(v_base->>'extra_charge_revenue')::numeric,'medicine return does not refund unrelated extra charge');
 perform public.test_assert((v_old->'metrics'->>'gross_sales')::numeric=(v_yesterday->>'gross_sales')::numeric+200 and (v_old->'metrics'->>'discounts')::numeric=(v_yesterday->>'discounts')::numeric+20,'gross sales and combined discounts use original snapshots once');
 perform public.test_assert((v_old->'metrics'->>'revenue')::numeric=(v_yesterday->>'revenue')::numeric+210 and (v_old->'metrics'->>'cogs')::numeric=(v_yesterday->>'cogs')::numeric+40,'sale-date figures include extra charges and actual recorded sold costs, excluding future refunds');
 perform public.test_assert((v_now->'metrics'->>'expenses')::numeric=(v_base->>'expenses')::numeric+50,'inventory receipt is not an operating expense');
 perform public.test_assert((select (c->>'amount')::numeric=50 from jsonb_array_elements(v_now->'expense_categories') c where c->>'category'='Financial Test Utilities'),'expense category breakdown reconciles to recorded expenses');
 perform public.test_assert(jsonb_array_length(v_now->'trend')=extract(hour from now() at time zone 'Asia/Karachi')::integer+1,'Today fills hourly buckets through the current Karachi hour');
 perform public.test_assert((select sum((p->>'revenue')::numeric)=(v_now->'metrics'->>'revenue')::numeric and sum((p->>'gross_profit')::numeric)=(v_now->'metrics'->>'gross_profit')::numeric from jsonb_array_elements(v_now->'trend') p),'hourly revenue and profit reconcile with totals');
 v_period:=public.owner_financial_analytics(v_today-6,v_today);
 perform public.test_assert(jsonb_array_length(v_period->'daily')=7 and (select sum((d->>'net_operating_profit')::numeric)=(v_period->'metrics'->>'net_operating_profit')::numeric from jsonb_array_elements(v_period->'daily') d),'daily summaries and financial totals reconcile');
 perform public.test_assert((v_now->'inventory'->>'total_medicines')::integer>0,'dashboard inventory summary uses existing stock');
 perform public.test_assert((public.owner_financial_analytics('1900-01-01','1900-01-02')->'metrics'->>'revenue')::numeric=0,'empty period returns real zero totals and usable buckets');
end $$;
-- Fractional-paisa purchase costs must reconcile even when sales fall in different hours.
insert into public.test_ids select 'finance-fractional-med',(public.save_guided_medicine(null,
 '{"name":"Fractional cost analytics fixture","dosage_form":"Tablet","barcode":"FINANCE-ROUNDING","tablets_per_strip":10,"strips_per_box":10,"units":[{"unit_key":"base","selling_price":1},{"unit_key":"strip","selling_price":10},{"unit_key":"box","selling_price":100}]}',
 '{"unit_key":"box","quantity":1,"batch_number":"FINANCE-ROUNDING","expiry_date":"2099-12-25","total_cost":12.55}',gen_random_uuid())->>'id')::uuid;
insert into public.test_ids select 'finance-hour-first',sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='finance-fractional-med'),'quantity',1)),'cash',1,0,gen_random_uuid());
insert into public.test_ids select 'finance-hour-last',sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='finance-fractional-med'),'quantity',1)),'cash',1,0,gen_random_uuid());
reset role;
update public.sales set completed_at=((now() at time zone 'Asia/Karachi')::date-1)::timestamp at time zone 'Asia/Karachi' where id=(select id from public.test_ids where label='finance-hour-first');
update public.sales set completed_at=(((now() at time zone 'Asia/Karachi')::date-1)::timestamp+interval '23 hours 59 minutes 59 seconds') at time zone 'Asia/Karachi' where id=(select id from public.test_ids where label='finance-hour-last');
set local role authenticated;
do $$
declare v_snapshot jsonb:=public.owner_financial_analytics((now() at time zone 'Asia/Karachi')::date-1,(now() at time zone 'Asia/Karachi')::date-1,'hour');
begin
 perform public.test_assert((select sum((h->>'gross_profit')::numeric)=(v_snapshot->'metrics'->>'gross_profit')::numeric from jsonb_array_elements(v_snapshot->'trend') h),'fractional-paisa batch costs reconcile across hourly profit buckets');
 perform public.test_assert((select sum((h->>'cogs')::numeric)=(v_snapshot->'metrics'->>'cogs')::numeric from jsonb_array_elements(v_snapshot->'trend') h),'hourly medicine cost rounding reconciles exactly to daily cost');
 perform public.test_assert((select (h->>'sales_count')::integer>=1 from jsonb_array_elements(v_snapshot->'trend') h where (h->>'bucket_start')::timestamptz=(((now() at time zone 'Asia/Karachi')::date-1)::timestamp at time zone 'Asia/Karachi')),'Karachi midnight sale is included in the correct day');
end $$;
select public.request_sale_return((select id from public.test_ids where label='finance-sale'),(select jsonb_build_array(jsonb_build_object('sale_item_id',id,'quantity',1)) from public.sale_items where sale_id=(select id from public.test_ids where label='finance-sale')),'Historical pending request only');
select public.test_assert((public.owner_financial_analytics((now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date)->'metrics'->>'refunds')::numeric=(select (today->'metrics'->>'refunds')::numeric+18 from financial_before),'pending requests do not affect financials');
select public.test_denied($q$select public.owner_financial_analytics(current_date,current_date+1)$q$,'future dates rejected');
select public.test_denied($q$select public.owner_financial_analytics(current_date-400,current_date)$q$,'unbounded financial report rejected');
select public.test_denied($q$select public.owner_financial_analytics(current_date-1,current_date,'hour')$q$,'hourly query limited to one date');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.test_denied($q$select public.owner_financial_analytics(current_date,current_date)$q$,'salesperson cannot access financial analytics through direct RPC');
reset role;
update public.profiles set is_active=false where id='10000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select public.test_denied($q$select public.owner_financial_analytics(current_date,current_date)$q$,'inactive owner cannot access financial analytics');
rollback;
