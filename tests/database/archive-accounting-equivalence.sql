-- Disposable PostgreSQL contracts only. All fixtures, archive publications and
-- attempted destructive statements are rolled back; no Storage call is made.
begin;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);

create function pg_temp.archive_eq_fingerprint() returns jsonb language plpgsql as $$
declare v_table text; v_value jsonb; v_result jsonb:='{}';
begin
 foreach v_table in array array['sales','sale_items','sale_item_costs','payments','sale_returns','return_items','return_allocations',
   'medicine_batches','medicines','medicine_units','medicine_costs','stock_movements','purchases','purchase_items','stock_receipts',
   'expenses','expense_categories','stock_dispositions','suppliers','profiles','user_roles','pharmacy_settings'] loop
  execute format('select jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(to_jsonb(t)::text,''|'' order by to_jsonb(t)::text),''''))) from public.%I t',v_table) into v_value;
  v_result:=v_result||jsonb_build_object(v_table,v_value);
 end loop;
 return v_result;
end $$;

-- Preserve the pre-existing fixture cost at full numeric precision. The oracle
-- below adds literal independently known costs, then rounds once for the period.
create function pg_temp.archive_eq_raw_cost(p_from date,p_to date) returns numeric language sql as $$
 select coalesce(sum(amount),0) from (
  select sic.quantity*sic.unit_cost amount from public.sales s join public.sale_items si on si.sale_id=s.id
   join public.sale_item_costs sic on sic.sale_item_id=si.id
   where (s.completed_at at time zone 'Asia/Karachi')::date between p_from and p_to
    and s.status in ('completed','partially_refunded','refunded')
  union all
  select -coalesce((select sum(a.base_quantity*a.unit_cost) from public.return_allocations a where a.return_item_id=ri.id),
   coalesce(ri.approved_base_quantity,ri.approved_quantity*coalesce(si.base_units_per_sale_unit,1))*
   (select sum(c.quantity*c.unit_cost)/nullif(sum(c.quantity),0) from public.sale_item_costs c where c.sale_item_id=si.id),0)
  from public.sale_returns r join public.return_items ri on ri.return_id=r.id join public.sale_items si on si.id=ri.sale_item_id
  where r.status='approved' and ri.restockable is true and (r.reviewed_at at time zone 'Asia/Karachi')::date between p_from and p_to
 ) costs;
$$;

create function pg_temp.archive_eq_snapshot(p_from date,p_to date,p_granularity text) returns jsonb language sql as $$
 select jsonb_build_object(
  'financial',public.owner_financial_analytics(p_from,p_to,p_granularity,true)-'generated_at',
  'dashboard',public.owner_dashboard_metrics(p_from,p_to),
  'chart',(select coalesce(jsonb_agg(to_jsonb(t) order by sale_date),'[]') from public.owner_sales_trend(p_from,p_to) t),
  'breakdowns',public.owner_report_breakdowns(p_from,p_to),
  'supplier',public.supplier_purchase_summary('ef160000-0000-4000-8000-000000000001'),
  'posted_purchases',(select jsonb_build_object('count',count(*),'total',coalesce(sum(total),0)) from public.purchases
    where status='posted' and (posted_at at time zone 'Asia/Karachi')::date between p_from and p_to and posted_at<=now()));
$$;

create function pg_temp.archive_eq_manifest(p_previous jsonb,p_candidates jsonb) returns jsonb language sql as $$
 select coalesce(jsonb_agg(jsonb_build_object('sale_id',sale_id,'source_sha256',source_sha256) order by sale_id),'[]') from (
  select distinct on (item->>'sale_id') item->>'sale_id' sale_id,item->>'source_sha256' source_sha256
  from (select value item,0 priority from jsonb_array_elements(p_previous)
    union all select value,1 from jsonb_array_elements(p_candidates)) entries
  order by item->>'sale_id',priority desc
 ) merged;
$$;

create temporary table archive_eq_periods(label text primary key,from_date date,to_date date,granularity text,baseline jsonb,baseline_raw_cost numeric,before_archive jsonb);
insert into archive_eq_periods(label,from_date,to_date,granularity)
select label,from_date,today,granularity from (select (now() at time zone 'Asia/Karachi')::date today) d
cross join lateral(values
 ('today',today,'hour'),('yesterday',today-1,'day'),('week',date_trunc('week',today::timestamp)::date,'day'),
 ('month',date_trunc('month',today::timestamp)::date,'day'),('quarter',today-90,'day'),('year',today-365,'day'),
 ('old16',today-16,'day'),('old90',today-90,'day'),('old365',today-365,'day')) p(label,from_date,granularity);
-- The three old-date probes and yesterday query exactly one historical day.
update archive_eq_periods set to_date=from_date where label in ('yesterday','old16','old90','old365');
update archive_eq_periods set baseline=pg_temp.archive_eq_snapshot(from_date,to_date,granularity),baseline_raw_cost=pg_temp.archive_eq_raw_cost(from_date,to_date);
create temporary table archive_eq_state(label text primary key,value jsonb);
create temporary table archive_eq_ids(label text primary key,id uuid);
create temporary table archive_eq_plan(label text primary key,age integer,medicine text,unit_key text,quantity integer,gross numeric,item_discount numeric,bill_discount numeric,extras numeric,revenue numeric,raw_cost numeric,base_quantity integer,method public.payment_method,cashier uuid,sale_id uuid,event_at timestamptz);
insert into archive_eq_plan(label,age,medicine,unit_key,quantity,gross,item_discount,bill_discount,extras,revenue,raw_cost,base_quantity,method,cashier) values
 ('old16',16,'fractional','strip',2,20,1,2,3,20,2.5100,20,'cash','10000000-0000-0000-0000-000000000001'),
 ('old90',90,'fractional','base',1,1,0,0,0,1,0.1255,1,'card','20000000-0000-0000-0000-000000000002'),
 ('old365',365,'regular','strip',1,18,1,2,4,19,20,10,'cash','10000000-0000-0000-0000-000000000001'),
 ('today',0,'fractional','base',2,2,0,0,0,2,0.2510,2,'cash','10000000-0000-0000-0000-000000000001'),
 ('yesterday',1,'fractional','base',1,1,0,0,0,1,0.1255,1,'card','20000000-0000-0000-0000-000000000002'),
 ('recent14',14,'fractional','base',1,1,0,0,0,1,0.1255,1,'cash','10000000-0000-0000-0000-000000000001'),
 ('pending17',17,'fractional','base',2,2,0,0,0,2,0.2510,2,'cash','10000000-0000-0000-0000-000000000001'),
 ('inside15',15,'fractional','base',1,1,0,0,0,1,0.1255,1,'card','20000000-0000-0000-0000-000000000002');
grant all on archive_eq_ids,archive_eq_plan,archive_eq_state,archive_eq_periods to authenticated,service_role;

set local role authenticated;
insert into public.suppliers(id,name,created_by) values('ef160000-0000-4000-8000-000000000001','Archive accounting contract supplier',auth.uid());
insert into archive_eq_ids select 'fractional',(public.save_guided_medicine(null,
 '{"name":"Archive fractional cost medicine","dosage_form":"Tablet","barcode":"ARCHIVE-EQ-FRACTIONAL","tablets_per_strip":10,"strips_per_box":10,"units":[{"unit_key":"base","selling_price":1},{"unit_key":"strip","selling_price":10},{"unit_key":"box","selling_price":100}]}',
 '{"unit_key":"box","quantity":1,"batch_number":"ARCHIVE-EQ-FRACTIONAL","expiry_date":"2099-12-25","total_cost":12.55,"supplier_id":"ef160000-0000-4000-8000-000000000001"}',gen_random_uuid())->>'id')::uuid;
insert into archive_eq_ids select 'regular',(public.save_guided_medicine(null,
 '{"name":"Archive regular cost medicine","dosage_form":"Tablet","barcode":"ARCHIVE-EQ-REGULAR","tablets_per_strip":10,"strips_per_box":10,"units":[{"unit_key":"base","selling_price":2},{"unit_key":"strip","selling_price":18},{"unit_key":"box","selling_price":180}]}',
 '{"unit_key":"box","quantity":1,"batch_number":"ARCHIVE-EQ-REGULAR","expiry_date":"2099-12-25","total_cost":200,"supplier_id":"ef160000-0000-4000-8000-000000000001"}',gen_random_uuid())->>'id')::uuid;
do $$ declare p record; v_sale uuid; begin
 for p in select * from archive_eq_plan order by label loop
  perform set_config('request.jwt.claim.sub',p.cashier::text,true);
  select sale_id into v_sale from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from archive_eq_ids where label=p.medicine),
   'unit_key',p.unit_key,'quantity',p.quantity,'line_discount',p.item_discount)),p.method,case when p.method='cash' then 100 else null end,p.bill_discount,gen_random_uuid(),null,null,p.extras,'Archive contract delivery');
  update archive_eq_plan set sale_id=v_sale,event_at=case when p.label='inside15' then now()-interval '15 days'+interval '1 hour'
   when p.age=0 then now() else (((now() at time zone 'Asia/Karachi')::date-p.age)::timestamp+interval '12 hours') at time zone 'Asia/Karachi' end where label=p.label;
 end loop;
 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
end $$;
insert into public.expense_categories(id,name) values('ef160000-0000-4000-8000-000000000002','Archive contract operating expense');
insert into public.expenses(category_id,amount,expense_date,description,created_by) values('ef160000-0000-4000-8000-000000000002',7.25,(now() at time zone 'Asia/Karachi')::date,'Independent archive accounting expense',auth.uid());
insert into archive_eq_ids select 'pending_return',public.request_sale_return((select sale_id from archive_eq_plan where label='pending17'),
 (select jsonb_build_array(jsonb_build_object('sale_item_id',id,'quantity',1)) from public.sale_items where sale_id=(select sale_id from archive_eq_plan where label='pending17')),'Pending archive accounting request');
reset role;
update public.sales s set completed_at=p.event_at from archive_eq_plan p where s.id=p.sale_id;

-- These literal accounting expectations are independent of the archive RPCs
-- and establish a valid baseline before any archive metadata is published.
do $$ declare v_period record; v jsonb; b jsonb; g numeric; d numeric; x numeric; n numeric; c numeric; e numeric; k bigint; begin
 perform public.test_assert((select sum(gross)=46 and sum(item_discount+bill_discount)=6 and sum(extras)=7 and sum(revenue)=47 and sum(raw_cost)=23.514 and count(*)=8 from archive_eq_plan),'archive fixtures have literal known gross, discounts, extras, revenue, cost and count');
 perform public.test_assert((select bool_and(s.subtotal=p.gross and s.discount=p.item_discount+p.bill_discount and s.extra_charge_amount=p.extras and s.net_total=p.revenue) from archive_eq_plan p join public.sales s on s.id=p.sale_id),'cash/card sale headers preserve independently specified charged amounts');
 perform public.test_assert((select count(*)=8 and bool_and(pay.method=p.method and pay.amount=p.revenue and (pay.method='card' or pay.tendered_amount-pay.change_amount=pay.amount)) from archive_eq_plan p join public.payments pay on pay.sale_id=p.sale_id and pay.kind='sale'),'payment kinds, cash change and card amounts reconcile once per invoice');
 perform public.test_assert((select sum(c.quantity*c.unit_cost)=23.514 from public.sale_item_costs c join public.sale_items i on i.id=c.sale_item_id join archive_eq_plan p on p.sale_id=i.sale_id),'recorded batch COGS retains fractional-paisa precision');
 perform public.test_assert((select sum(quantity_on_hand)=72 and min(purchase_cost)=0.1255 from public.medicine_batches where medicine_id=(select id from archive_eq_ids where label='fractional')),'fractional-cost batch stock is 100 minus 28 sold base units');
 perform public.test_assert((select sum(quantity_on_hand)=90 from public.medicine_batches where medicine_id=(select id from archive_eq_ids where label='regular')),'regular-cost batch stock is 100 minus ten sold base units');
 v:=public.supplier_purchase_summary('ef160000-0000-4000-8000-000000000001');
 perform public.test_assert((v->>'total')::numeric=212.55 and (v->>'deliveries')::integer=2 and (v->>'medicineCount')::integer=2,'supplier purchase totals retain both exact original receipts');
 for v_period in select * from archive_eq_periods loop
  v:=public.owner_financial_analytics(v_period.from_date,v_period.to_date,v_period.granularity); b:=v_period.baseline->'financial'->'metrics';
  select coalesce(sum(gross),0),coalesce(sum(item_discount+bill_discount),0),coalesce(sum(extras),0),coalesce(sum(revenue),0),coalesce(sum(raw_cost),0),count(*) into g,d,x,n,c,k
   from archive_eq_plan where (event_at at time zone 'Asia/Karachi')::date between v_period.from_date and v_period.to_date;
  e:=case when (now() at time zone 'Asia/Karachi')::date between v_period.from_date and v_period.to_date then 7.25 else 0 end;
  perform public.test_assert((v->'metrics'->>'gross_sales')::numeric=(b->>'gross_sales')::numeric+g and (v->'metrics'->>'discounts')::numeric=(b->>'discounts')::numeric+d and (v->'metrics'->>'extra_charge_revenue')::numeric=(b->>'extra_charge_revenue')::numeric+x,'independent gross/discount/extra oracle: '||v_period.label);
  perform public.test_assert((v->'metrics'->>'revenue')::numeric=(b->>'revenue')::numeric+n and (v->'metrics'->>'sales_count')::bigint=(b->>'sales_count')::bigint+k,'independent sales revenue/count oracle: '||v_period.label);
  perform public.test_assert((v->'metrics'->>'cogs')::numeric=round(v_period.baseline_raw_cost+c,2) and (v->'metrics'->>'gross_profit')::numeric=(b->>'revenue')::numeric+n-round(v_period.baseline_raw_cost+c,2),'independent raw-cost and medicine-profit oracle: '||v_period.label);
  perform public.test_assert((v->'metrics'->>'expenses')::numeric=(b->>'expenses')::numeric+e and (v->'metrics'->>'net_operating_profit')::numeric=(v->'metrics'->>'gross_profit')::numeric-(b->>'expenses')::numeric-e-(b->>'net_inventory_loss')::numeric,'independent operating expense/profit oracle: '||v_period.label);
 end loop;
end $$;
update archive_eq_periods set before_archive=pg_temp.archive_eq_snapshot(from_date,to_date,granularity);
insert into archive_eq_state values('canonical_before',pg_temp.archive_eq_fingerprint()),('lifetime_before',public.owner_dashboard_metrics('1900-01-01',(now() at time zone 'Asia/Karachi')::date));

-- Even an elevated caller cannot silently delete a referenced invoice. The
-- exception subtransaction guarantees the deliberate attempt leaves no change.
do $$ declare v_blocked boolean:=false; begin
 begin delete from public.sales where id=(select sale_id from archive_eq_plan where label='old16');
 exception when foreign_key_violation then v_blocked:=true; end;
 perform public.test_assert(v_blocked,'unsafe deletion of a financial source invoice is blocked by canonical foreign keys');
 perform public.test_assert(pg_temp.archive_eq_fingerprint()=(select value from archive_eq_state where label='canonical_before'),'blocked deletion rolls back without changing any canonical accounting or stock row');
end $$;
update private.invoice_archive_settings set enabled=true where singleton_id;
set local role service_role;
do $$ declare c jsonb; b jsonb; m jsonb; r jsonb; h text:=repeat('a',64); k text; begin
 c:=public.invoice_archive_claim(false);
 perform public.test_assert(c->>'status'='claimed' and (c->>'dry_run')::boolean=false,'real non-dry-run archive lease acquired by the service role');
 b:=public.invoice_archive_batch((c->>'lease')::uuid,(c->>'fence')::bigint,25);
 perform public.test_assert((select count(*)=3 from jsonb_array_elements(b->'candidates') x join archive_eq_plan p on p.sale_id=(x->>'sale_id')::uuid where p.label in ('old16','old90','old365')),'fixed archive batch includes month/quarter/year eligible original invoices');
 perform public.test_assert(not exists(select 1 from jsonb_array_elements(b->'candidates') x join archive_eq_plan p on p.sale_id=(x->>'sale_id')::uuid where p.label in ('today','yesterday','recent14','inside15','pending17')),'recent, inside-fifteen-day and pending-return invoices cannot enter an archive commit');
 m:=pg_temp.archive_eq_manifest('[]',b->'candidates');
 k:='versions/'||((b->>'expected_generation')::bigint+1)::text||'/'||(c->>'lease')||'-'||h||'.xlsx';
 r:=public.invoice_archive_commit((c->>'lease')::uuid,(c->>'fence')::bigint,(b->>'expected_generation')::bigint,k,h,1,m);
 perform public.test_assert(r->>'status'='committed' and (r->>'deleted_count')::bigint=0,'verified archive metadata is really committed without deleting canonical rows');
 insert into archive_eq_state values('lease',c),('manifest',m),('first_commit',r);
end $$;
reset role;
do $$ declare p record; begin
 perform public.test_assert(pg_temp.archive_eq_fingerprint()=(select value from archive_eq_state where label='canonical_before'),'archive commit preserves every canonical financial, inventory, stock-history, supplier and expense row byte-for-byte');
 for p in select * from archive_eq_periods loop
  perform public.test_assert(pg_temp.archive_eq_snapshot(p.from_date,p.to_date,p.granularity)=p.before_archive,'all dashboard/chart/report/cashier/medicine/supplier outputs survive archive: '||p.label);
 end loop;
 perform public.test_assert(public.owner_dashboard_metrics('1900-01-01',(now() at time zone 'Asia/Karachi')::date)=(select value from archive_eq_state where label='lifetime_before'),'lifetime legacy financial and inventory totals survive archival unchanged');
end $$;

-- Real late returns continue through the ordinary transaction RPC after the
-- original invoices have already been published in an archive generation.
set local role authenticated;
do $$ declare p record; i uuid; r jsonb; begin
 for p in select * from archive_eq_plan where label in ('old16','old90','old365') order by label loop
  select id into i from public.sale_items where sale_id=p.sale_id;
  r:=public.complete_sale_return(p.sale_id,jsonb_build_array(jsonb_build_object('sale_item_id',i,'quantity',1,'in_base_units',true,'restockable',p.label<>'old90')),'Late original-cost archive accounting refund',gen_random_uuid());
  perform public.test_assert((r->>'refund')::numeric=case p.label when 'old16' then 0.85 when 'old90' then 1 else 1.50 end,'late refund uses exact original discounted medicine price: '||p.label);
 end loop;
 perform public.review_sale_return((select id from archive_eq_ids where label='pending_return'),false,'[]','Pending request resolved before archive refresh','cash');
end $$;
reset role;
do $$ declare v jsonb; b jsonb; p record; expected_refund numeric; expected_profit numeric; begin
 v:=public.owner_financial_analytics((now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date,'hour');
 select before_archive->'financial'->'metrics' into b from archive_eq_periods where label='today';
 perform public.test_assert((v->'metrics'->>'refunds')::numeric=(b->>'refunds')::numeric+3.35 and (v->'metrics'->>'revenue')::numeric=(b->>'revenue')::numeric-3.35 and (v->'metrics'->>'sales_count')::bigint=(b->>'sales_count')::bigint,'month/quarter/year old invoices produce today refunds exactly once with no new sales');
 perform public.test_assert((v->'metrics'->>'cogs')::numeric=round((select baseline_raw_cost from archive_eq_periods where label='today')+0.2510-2.1255,2),'late resale returns reverse exact original fractional and regular costs; nonresale cost remains');
 perform public.test_assert((v->'metrics'->>'extra_charge_revenue')::numeric=(b->>'extra_charge_revenue')::numeric and (v->'metrics'->>'expenses')::numeric=(b->>'expenses')::numeric,'late medicine refunds do not refund extras or duplicate operating expenses');
 perform public.test_assert((select sum((h->>'cogs')::numeric)=(v->'metrics'->>'cogs')::numeric and sum((h->>'gross_profit')::numeric)=(v->'metrics'->>'gross_profit')::numeric from jsonb_array_elements(v->'trend') h),'hourly fractional-cost rounding still reconciles after archived historical refunds');
 for p in select * from archive_eq_periods where label in ('old16','old90','old365') loop
  perform public.test_assert((public.owner_financial_analytics(p.from_date,p.to_date)-'generated_at')=((p.before_archive->'financial')-'inventory'),'event-date accounting leaves the original historical sale period unchanged after a late refund: '||p.label);
  expected_refund:=case p.label when 'old16' then 0.85 when 'old90' then 1 else 1.50 end;
  expected_profit:=case p.label when 'old16' then 16.77 when 'old90' then -0.13 else -0.50 end;
  v:=public.owner_dashboard_metrics(p.from_date,p.to_date);
  perform public.test_assert((v->>'revenue')::numeric=(p.baseline->'dashboard'->>'revenue')::numeric+(select revenue from archive_eq_plan where label=p.label)-expected_refund and (v->>'gross_profit')::numeric=(p.baseline->'dashboard'->>'gross_profit')::numeric+expected_profit,'legacy original-sale-period refund and original-cost formula remains unchanged: '||p.label);
 end loop;
 perform public.test_assert((select sum(quantity_on_hand)=73 from public.medicine_batches where medicine_id=(select id from archive_eq_ids where label='fractional')) and (select sum(quantity_on_hand)=91 from public.medicine_batches where medicine_id=(select id from archive_eq_ids where label='regular')),'late returns restore only the two resale base units into their original batches');
 perform public.test_assert((select sum(case when m.kind='return_restock' then m.quantity_delta else 0 end)=2 and count(*) filter(where m.kind='return_non_sellable')=1 from public.stock_movements m where m.medicine_id in(select id from archive_eq_ids where label in ('fractional','regular')) and m.reference_type='sale_return'),'late return stock history records two resale units and one non-sellable return without duplicate movements');
end $$;
update archive_eq_periods set before_archive=pg_temp.archive_eq_snapshot(from_date,to_date,granularity);
insert into archive_eq_state values('canonical_after_refund',pg_temp.archive_eq_fingerprint()),('lifetime_after_refund',public.owner_dashboard_metrics('1900-01-01',(now() at time zone 'Asia/Karachi')::date));
set local role service_role;
do $$ declare c jsonb:=(select value from archive_eq_state where label='lease'); b jsonb; m jsonb; r jsonb; h text:=repeat('b',64); k text; begin
 perform public.invoice_archive_heartbeat((c->>'lease')::uuid,(c->>'fence')::bigint);
 b:=public.invoice_archive_batch((c->>'lease')::uuid,(c->>'fence')::bigint,25);
 perform public.test_assert((select count(*)=4 from jsonb_array_elements(b->'candidates') x join archive_eq_plan p on p.sale_id=(x->>'sale_id')::uuid where p.label in ('old16','old90','old365','pending17')),'archive refresh includes changed archived refunds and the now-resolved pending invoice');
 m:=pg_temp.archive_eq_manifest((select value from archive_eq_state where label='manifest'),b->'candidates');
 k:='versions/'||((b->>'expected_generation')::bigint+1)::text||'/'||(c->>'lease')||'-'||h||'.xlsx';
 r:=public.invoice_archive_commit((c->>'lease')::uuid,(c->>'fence')::bigint,(b->>'expected_generation')::bigint,k,h,2,m);
 perform public.test_assert(r->>'status'='committed' and (r->>'deleted_count')::bigint=0,'a real refreshed archive generation retains both old and late-refund accounting rows');
 perform public.test_assert((r->'current_version'->>'generation')::bigint=(select (value->'current_version'->>'generation')::bigint+1 from archive_eq_state where label='first_commit'),'late-refund publication advances exactly one archive generation');
 perform public.invoice_archive_release((c->>'lease')::uuid,(c->>'fence')::bigint);
end $$;
reset role;
do $$ declare p record; begin
 perform public.test_assert(pg_temp.archive_eq_fingerprint()=(select value from archive_eq_state where label='canonical_after_refund'),'refreshed archive commit preserves every post-refund canonical row without further accounting mutations');
 for p in select * from archive_eq_periods loop
  perform public.test_assert(pg_temp.archive_eq_snapshot(p.from_date,p.to_date,p.granularity)=p.before_archive,'post-refund financial and supplier reports survive archive refresh: '||p.label);
 end loop;
 perform public.test_assert(public.owner_dashboard_metrics('1900-01-01',(now() at time zone 'Asia/Karachi')::date)=(select value from archive_eq_state where label='lifetime_after_refund'),'lifetime financial results stay unchanged after late-refund archive refresh');
 perform public.test_assert((select bool_and(deleted_count=0 and canonical_before=canonical_after) from private.invoice_archive_versions),'all published archive versions attest zero canonical deletions');
end $$;
rollback;
