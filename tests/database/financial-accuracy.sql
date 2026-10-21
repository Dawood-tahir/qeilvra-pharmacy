-- Disposable fixtures only. Run before and after migration 018 to demonstrate
-- the original defects, then prove the literal expected amounts after fixing.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
create temporary table accuracy_baseline as select public.owner_financial_analytics((now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date) value;
insert into public.test_ids select 'accuracy-med',(public.save_guided_medicine(null,
 '{"name":"Precision audit fixture","dosage_form":"Tablet","tablets_per_strip":10,"strips_per_box":10,"units":[{"unit_key":"base","selling_price":1},{"unit_key":"strip","selling_price":10},{"unit_key":"box","selling_price":100}]}',
 '{"unit_key":"base","quantity":77900,"batch_number":"AUDIT-PRECISION","expiry_date":"2099-12-25","total_cost":9000}',gen_random_uuid())->>'id')::uuid;

do $$
declare v_batch uuid; v_result jsonb; v_replay jsonb; v_loss numeric; v_expected numeric;
 v_fixed boolean:=coalesce(current_setting('qeilvra.test_accuracy_fixed',true),'false')='true'; v_key uuid:=gen_random_uuid();
begin
 select id into v_batch from public.medicine_batches where batch_number='AUDIT-PRECISION';
 v_result:=public.dispose_stock(v_key,v_batch,'discard',1000,77900,'Isolated exact cost loss verification');
 v_replay:=public.dispose_stock(v_key,v_batch,'discard',1000,77900,'Isolated exact cost loss verification');
 select cost_value into v_loss from public.stock_dispositions where id=v_key;
 v_expected:=case when v_fixed then 115.53 else 115.50 end;
 perform public.test_assert(round(v_loss,2)=v_expected,'disposal preserves expected recorded precision before/after fix');
 perform public.test_assert((v_result->>'value')::numeric=115.53,'RPC initially returns full-precision batch valuation');
 perform public.test_assert((v_replay->>'value')::numeric=v_expected,'retry returns the identical stored valuation after fix');
 perform public.test_assert((select quantity_on_hand=76900 from public.medicine_batches where id=v_batch),'disposal retry does not remove stock twice');
 perform public.test_assert((select count(*)=1 from public.stock_movements where reference_type='stock_disposition' and reference_id=v_key),'exactly one stock loss movement');
 perform public.test_assert((public.owner_financial_analytics((now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date)->'metrics'->>'net_inventory_loss')::numeric=
  (select (value->'metrics'->>'net_inventory_loss')::numeric+v_expected from accuracy_baseline),'recognized inventory loss uses retained cost once');
end $$;

-- Ordinary purchase workflow must accept the same money range as its header.
insert into public.suppliers(id,name,created_by) values('f2000000-0000-4000-8000-000000000001','Large receipt audit fixture',auth.uid());
insert into public.test_ids select 'accuracy-purchase',public.create_purchase(
 '{"supplier_id":"f2000000-0000-4000-8000-000000000001","discount":12.34}',
 jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='accuracy-med'),'unit_key','box','quantity',2000,'unit_cost',500000,'batch_number','AUDIT-LARGE','expiry_date','2099-12-25')));
do $$
declare v_fixed boolean:=coalesce(current_setting('qeilvra.test_accuracy_fixed',true),'false')='true'; v_id uuid:=(select id from public.test_ids where label='accuracy-purchase');
begin
 if not v_fixed then
  begin perform public.post_purchase(v_id); raise exception 'Expected original money/quantity overflow';
  exception when numeric_value_out_of_range then null; end;
  perform public.test_assert((select status='draft' from public.purchases where id=v_id),'overflow rolls back without posting partial stock');
 else
  perform public.post_purchase(v_id);
  perform public.test_assert((select total=999999987.66 and subtotal=1000000000 and status='posted' from public.purchases where id=v_id),'large receipt posts exact subtotal less discount');
  perform public.test_assert((select quantity_on_hand=200000 and round(purchase_cost*quantity_on_hand,2)=999999987.66 from public.medicine_batches where batch_number='AUDIT-LARGE'),'pack conversion and proportional purchase discount preserve inventory value');
  perform public.test_denied('select public.post_purchase('''||v_id||''')','receipt cannot post twice');
 end if;
end $$;

-- Simulate a stale historical/imported draft in this disposable fixture only.
-- Posting must use recomputed totals for the existing batch discount formula.
insert into public.test_ids select 'accuracy-edited',public.create_purchase(
 '{"supplier_id":"f2000000-0000-4000-8000-000000000001","discount":1}',
 jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='accuracy-med'),'quantity',10,'unit_cost',1,'batch_number','AUDIT-EDITED','expiry_date','2099-12-25')));
reset role;
update public.purchases set discount=2,total=subtotal-2 where id=(select id from public.test_ids where label='accuracy-edited');
update public.purchase_items set unit_cost=2 where purchase_id=(select id from public.test_ids where label='accuracy-edited');
set local role authenticated;
select public.post_purchase((select id from public.test_ids where label='accuracy-edited'));
select public.test_assert((select round(purchase_cost*quantity_on_hand,2)=case when coalesce(current_setting('qeilvra.test_accuracy_fixed',true),'false')='true' then 18 else 16 end from public.medicine_batches where batch_number='AUDIT-EDITED'),'posting uses recomputed header for discount valuation');

insert into public.test_ids select 'accuracy-zero-med',(public.save_guided_medicine(null,
 '{"name":"Zero cost accuracy fixture","dosage_form":"Other","units":[{"unit_key":"base","selling_price":1}]}',
 '{"unit_key":"base","quantity":3,"batch_number":"AUDIT-ZERO","expiry_date":"2099-12-25","total_cost":0}',gen_random_uuid())->>'id')::uuid;
insert into public.test_ids select 'accuracy-zero-sale',sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='accuracy-zero-med'),'quantity',1)),'cash',1,0,gen_random_uuid());
select public.test_assert((public.owner_financial_analytics((now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date)->'metrics'->>'cogs')::numeric=(select (value->'metrics'->>'cogs')::numeric from accuracy_baseline),'an explicit zero-cost allocation remains valid');
-- Simulate missing historical costs only in this rollback-only local fixture.
reset role;
delete from public.sale_item_costs where sale_item_id in(select id from public.sale_items where sale_id=(select id from public.test_ids where label='accuracy-zero-sale'));
set local role authenticated;
do $$
begin
 if coalesce(current_setting('qeilvra.test_accuracy_fixed',true),'false')='true' then
  perform public.test_denied('select public.owner_financial_analytics((now() at time zone ''Asia/Karachi'')::date,(now() at time zone ''Asia/Karachi'')::date)','missing cost allocation stops financial reporting instead of silently assuming zero');
 else
  perform public.test_assert((public.owner_financial_analytics((now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date)->'metrics'->>'cogs')::numeric=(select (value->'metrics'->>'cogs')::numeric from accuracy_baseline),'original implementation treats missing allocations as zero');
 end if;
end $$;
reset role;
insert into public.expense_categories(id,name) values('f2000000-0000-4000-8000-000000000003','Finite money audit fixture');
insert into public.expenses(category_id,amount,expense_date,description,created_by)
 values('f2000000-0000-4000-8000-000000000003',123.01,(now() at time zone 'Asia/Karachi')::date,'Isolated finite money fixture','10000000-0000-0000-0000-000000000001');
do $$
begin
 if coalesce(current_setting('qeilvra.test_accuracy_fixed',true),'false')='true' then
  perform public.test_denied('update public.expenses set amount=''NaN''::numeric where category_id=''f2000000-0000-4000-8000-000000000003''','database refuses nonfinite expense amounts');
  perform public.test_denied('update public.medicine_batches set purchase_cost=''NaN''::numeric where batch_number=''AUDIT-ZERO''','database refuses nonfinite batch costs');
  perform public.test_denied('update public.purchase_items set unit_cost=''Infinity''::numeric where batch_number=''AUDIT-ZERO''','database refuses infinite purchase costs');
 end if;
end $$;
rollback;
