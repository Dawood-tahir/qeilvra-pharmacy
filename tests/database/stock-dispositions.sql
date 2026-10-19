begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
create temporary table stock_financial_before as select public.owner_financial_analytics((now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date) value;
insert into public.suppliers(id,name,created_by) values('de000000-0000-4000-8000-000000000001','Disposition supplier',auth.uid()),('de000000-0000-4000-8000-000000000002','Other disposition supplier',auth.uid());
insert into public.test_ids select 'disposition-med',(public.save_guided_medicine(null,
 '{"name":"Stock disposition fixture","dosage_form":"Tablet","barcode":"DISPOSITION-ONLY","tablets_per_strip":10,"strips_per_box":10,"units":[{"unit_key":"base","selling_price":10},{"unit_key":"strip","selling_price":90},{"unit_key":"box","selling_price":900}]}',
 '{"unit_key":"box","quantity":5,"batch_number":"DISPOSE-ONLY","expiry_date":"2099-12-25","total_cost":1000,"supplier_id":"de000000-0000-4000-8000-000000000001"}',gen_random_uuid())->>'id')::uuid;
insert into public.test_ids select 'disposition-batch',id from public.medicine_batches where medicine_id=(select id from public.test_ids where label='disposition-med');
reset role;
update public.medicine_batches set expiry_date=(now() at time zone 'Asia/Karachi')::date-1,supplier_id=null where id=(select id from public.test_ids where label='disposition-batch');
set local role authenticated;
select public.test_denied($q$select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='disposition-med'),'quantity',1)),'cash',10,0,gen_random_uuid())$q$,'expired stock cannot sell even before disposal');
do $$
declare v_batch uuid:=(select id from public.test_ids where label='disposition-batch'); v_key uuid:=gen_random_uuid(); v_result jsonb; v_request text;
begin
 v_result:=public.dispose_stock(v_key,v_batch,'discard',7,500,'Expired stock physically discarded');
 perform public.test_assert((v_result->>'quantity')::numeric=493 and (v_result->>'value')::numeric=14,'partial expired disposal uses original batch cost and deducts only discarded quantity');
 perform public.test_assert(public.dispose_stock(v_key,v_batch,'discard',7,500,'Expired stock physically discarded')=v_result,'same-key retry returns the original result');
 perform public.test_assert((select count(*)=1 and sum(quantity_delta)=-7 from public.stock_movements where reference_type='stock_disposition' and reference_id=v_key),'retry creates one inventory movement only');
 perform public.test_denied(format('select public.dispose_stock(%L,%L,''discard'',7,500,''Different details'')',v_key,v_batch),'changed-payload retry is denied');
 perform public.test_denied(format('select public.dispose_stock(%L,%L,''discard'',7,500,''Stale second action'')',gen_random_uuid(),v_batch),'stale different-key removal cannot deduct stock again');
 perform public.test_denied(format('select public.dispose_stock(%L,%L,''discard'',494,493,''Excess stock removal'')',gen_random_uuid(),v_batch),'cannot create negative inventory');
 perform public.test_denied(format('select public.dispose_stock(%L,%L,''supplier_return'',10,493,''Wrong dealer selected'',''de000000-0000-4000-8000-000000000002'')',gen_random_uuid(),v_batch),'supplier is enforced from original purchase even if batch supplier is missing');
end $$;
insert into public.test_ids select 'disposition-return',(public.dispose_stock(gen_random_uuid(),(select id from public.test_ids where label='disposition-batch'),'supplier_return',10,493,'Segregated and returned to original dealer','de000000-0000-4000-8000-000000000001','credit')->>'id')::uuid;
select public.test_assert((select recovery_state='pending' and recovery_amount=0 and cost_value=20 and purchase_id is not null from public.stock_dispositions where id=(select id from public.test_ids where label='disposition-return')),'pending supplier return retains purchase association and no invented recovery');
do $$
declare v_now jsonb:=public.owner_financial_analytics((now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date); v_base jsonb:=(select value->'metrics' from stock_financial_before);
begin
 perform public.test_assert((v_now->'metrics'->>'net_inventory_loss')::numeric=34,'discard and pending supplier return are recognized at batch cost');
 perform public.test_assert((v_now->'metrics'->>'supplier_recoveries')::numeric=0,'pending supplier credit is excluded from received recoveries');
 perform public.test_assert((v_now->'metrics'->>'revenue')::numeric=(v_base->>'revenue')::numeric and (v_now->'metrics'->>'expenses')::numeric=(v_base->>'expenses')::numeric,'stock losses are neither customer revenue nor duplicate ordinary expenses');
end $$;
do $$
declare v_key uuid:=gen_random_uuid(); v_id uuid:=(select id from public.test_ids where label='disposition-return'); v_result jsonb;
begin
 v_result:=public.confirm_supplier_recovery(v_key,v_id,'credit',12,'Credit note 123');
 perform public.test_assert(public.confirm_supplier_recovery(v_key,v_id,'credit',12,'Credit note 123')=v_result,'confirmed credit retry is idempotent');
 perform public.test_denied(format('select public.confirm_supplier_recovery(%L,%L,''credit'',13,''Changed credit'')',v_key,v_id),'credit amount cannot be changed by retry');
 perform public.test_denied(format('select public.confirm_supplier_recovery(%L,%L,''refund'',12,''Duplicate refund'')',gen_random_uuid(),v_id),'distinct keys cannot duplicate recovery');
 perform public.test_assert((select quantity_on_hand=483 from public.medicine_batches where id=(select id from public.test_ids where label='disposition-batch')),'settlement never deducts original stock again');
end $$;
insert into public.test_ids select 'disposition-replacement',(public.dispose_stock(gen_random_uuid(),(select id from public.test_ids where label='disposition-batch'),'supplier_return',5,483,'Dealer will replace damaged tablets','de000000-0000-4000-8000-000000000001','replacement')->>'id')::uuid;
do $$
declare v_id uuid:=(select id from public.test_ids where label='disposition-replacement'); v_key uuid:=gen_random_uuid(); v_result jsonb; v_replacement jsonb:='{"batch_number":"REPLACED-ONLY","expiry_date":"2099-12-25","quantity":4}';
begin
 perform public.test_denied(format('select public.confirm_supplier_recovery(%L,%L,''replacement'',8,'''',%L)',v_key,v_id,'{"batch_number":"EXPIRED","expiry_date":"1900-01-01","quantity":4}'),'invalid replacement receipt rolls back settlement and stock atomically');
 perform public.test_assert((select recovery_state='pending' from public.stock_dispositions where id=v_id),'failed replacement stays pending');
 v_result:=public.confirm_supplier_recovery(v_key,v_id,'replacement',8,'Replacement delivery',v_replacement);
 perform public.test_assert(public.confirm_supplier_recovery(v_key,v_id,'replacement',8,'Replacement delivery',v_replacement)=v_result,'replacement retry does not receive stock twice');
 perform public.test_assert((select count(*)=1 and sum(quantity_on_hand)=4 and min(purchase_cost)=2 from public.medicine_batches where medicine_id=(select id from public.test_ids where label='disposition-med') and batch_number='REPLACED-ONLY'),'replacement stock is a real new batch with recorded cost');
 perform public.test_assert((select replacement_purchase_id is not null from public.stock_dispositions where id=v_id),'replacement receipt is linked to the original supplier return');
end $$;
do $$
declare v_data jsonb:=public.owner_financial_analytics((now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date); v_base jsonb:=(select value->'metrics' from stock_financial_before);
begin
 perform public.test_assert((v_data->'metrics'->>'stock_written_off')::numeric=14 and (v_data->'metrics'->>'supplier_returns_value')::numeric=30,'reports split actual write-offs and returned stock values');
 perform public.test_assert((v_data->'metrics'->>'supplier_recoveries')::numeric=12 and (v_data->'metrics'->>'supplier_replacements_value')::numeric=8,'replacement recovery is separate from supplier cash/credit and customer sales');
 perform public.test_assert((v_data->'metrics'->>'net_inventory_loss')::numeric=24 and (v_data->'metrics'->>'net_operating_profit')::numeric=(v_base->>'net_operating_profit')::numeric-24,'profit subtracts net inventory loss once after actual recoveries');
 perform public.test_assert((v_data->'metrics'->>'cogs')::numeric=(v_base->>'cogs')::numeric and (v_data->'metrics'->>'gross_profit')::numeric=(v_base->>'gross_profit')::numeric,'unsold inventory losses do not double count medicine COGS');
 perform public.test_assert((select sum((d->>'net_operating_profit')::numeric)=(v_data->'metrics'->>'net_operating_profit')::numeric from jsonb_array_elements(v_data->'daily') d),'daily profit reconciles after losses and supplier recoveries');
 perform public.test_assert((select sum(quantity_on_hand)=482 from public.medicine_batches where medicine_id=(select id from public.test_ids where label='disposition-med')),'discard, supplier return and replacement reconcile physical inventory');
end $$;
select public.test_denied($q$update public.stock_dispositions set recovery_amount=999$q$,'even Owner direct writes cannot bypass audited stock operations');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.test_assert((select count(*)=0 from public.stock_dispositions),'Salesperson cannot read stock loss or supplier financial records');
select public.test_denied($q$select public.dispose_stock(gen_random_uuid(),(select id from public.test_ids where label='disposition-batch'),'discard',1,478,'Forbidden staff disposal')$q$,'Salesperson cannot discard stock');
select public.test_denied($q$select public.confirm_supplier_recovery(gen_random_uuid(),gen_random_uuid(),'refund',1)$q$,'Salesperson cannot confirm dealer recoveries');
reset role;
update public.profiles set is_active=false where id='10000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select public.test_denied($q$select public.dispose_stock(gen_random_uuid(),gen_random_uuid(),'discard',1,1,'Inactive owner')$q$,'inactive owner cannot remove stock');
select public.test_denied($q$select private.sales_financial_analytics(current_date,current_date)$q$,'internal base financial query remains inaccessible directly');
rollback;
