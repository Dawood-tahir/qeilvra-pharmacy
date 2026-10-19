begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
insert into public.test_ids select 'instant-medicine',(public.save_guided_medicine(null,
 '{"name":"Instant return fixture","dosage_form":"Tablet","strength":"500mg","barcode":"INSTANT-RETURN","tablets_per_strip":10,"strips_per_box":10,"units":[{"unit_key":"base","selling_price":7},{"unit_key":"strip","selling_price":65},{"unit_key":"box","selling_price":620}]}',
 '{"unit_key":"box","quantity":5,"batch_number":"INSTANT-BATCH","expiry_date":"2099-12-25","total_cost":500}',gen_random_uuid())->>'id')::uuid;
insert into public.test_ids select 'instant-owner-sale',sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='instant-medicine'),'unit_key','base','quantity',3,'expected_price',3.33,'catalogue_price',7,'custom_price',3.33)),'cash',10,0.01,gen_random_uuid());
do $$
declare v_sale uuid:=(select id from public.test_ids where label='instant-owner-sale'); v_line uuid; v_total numeric:=0; v_result jsonb;
begin
 select id into v_line from public.sale_items where sale_id=v_sale;
 for n in 1..3 loop
   v_result:=public.complete_sale_return(v_sale,jsonb_build_array(jsonb_build_object('sale_item_id',v_line,'quantity',1,'restockable',true)),'Original discounted custom price',gen_random_uuid());
   v_total:=v_total+(v_result->>'refund')::numeric;
 end loop;
 perform public.test_assert(v_total=9.98,'Owner immediate partial returns preserve custom price, invoice discount and cumulative rounding');
 perform public.test_assert((select status='refunded' from public.sales where id=v_sale),'full immediate refund updates sale status');
 perform public.test_assert((select count(*)=3 and bool_and(status='approved' and requested_by=reviewed_by) from public.sale_returns where sale_id=v_sale),'no pending requests or separate approval are committed');
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into public.test_ids select 'instant-staff-sale',sale_id from public.checkout_sale(jsonb_build_array(
 jsonb_build_object('medicine_id',(select id from public.test_ids where label='instant-medicine'),'unit_key','base','quantity',5),
 jsonb_build_object('medicine_id',(select id from public.test_ids where label='instant-medicine'),'unit_key','strip','quantity',3),
 jsonb_build_object('medicine_id',(select id from public.test_ids where label='instant-medicine'),'unit_key','box','quantity',1)), 'cash',850,10,gen_random_uuid());
do $$
declare v_sale uuid:=(select id from public.test_ids where label='instant-staff-sale'); v_line uuid; v_key uuid:=gen_random_uuid(); v_items jsonb; v_result jsonb; v_retry jsonb; v_expected numeric;
begin
 select id,round(net_line_total*2/quantity,2) into v_line,v_expected from public.sale_items where sale_id=v_sale and selling_unit='base';
 v_items:=jsonb_build_array(jsonb_build_object('sale_item_id',v_line,'quantity',2,'restockable',true));
 v_result:=public.complete_sale_return(v_sale,v_items,'Two sealed tablets returned',v_key);
 v_retry:=public.complete_sale_return(v_sale,v_items,'Two sealed tablets returned',v_key);
 perform public.test_assert(v_result=v_retry and (v_result->>'refund')::numeric=v_expected,'Salesperson completes an immediate discounted refund; retries return the same result');
 perform public.test_assert((select count(*)=1 from public.payments where return_id=v_key and kind='refund'),'retry cannot duplicate refund payment');
 perform public.test_assert((select status='approved' and requested_by=auth.uid() and reviewed_by=auth.uid() from public.sale_returns where id=v_key),'Salesperson return completes without Owner approval');
 perform public.test_denied(format('select public.complete_sale_return(%L,%L,%L,%L)',v_sale,v_items::text,'Different reason',v_key),'same key with a changed payload is rejected');
 perform public.test_denied(format('select public.complete_sale_return(%L,%L,%L,%L)',v_sale,(v_items||v_items)::text,'Duplicate medicine lines',gen_random_uuid()),'duplicate line IDs cannot double refund');
 perform public.test_denied(format('select public.complete_sale_return(%L,%L,%L,%L)',(select id from public.test_ids where label='instant-owner-sale'),v_items::text,'Another cashier sale',gen_random_uuid()),'Salesperson cannot refund another cashier sale');
 perform public.test_denied(format('select private.apply_sale_return(%L,true,%L)',v_key,'[]'),'internal allocation helper is not directly callable');
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$
declare v_sale uuid:=(select id from public.test_ids where label='instant-staff-sale'); v_line uuid; v_items jsonb; v_result jsonb; v_value jsonb; v_expected numeric;
begin
 select id into v_line from public.sale_items where sale_id=v_sale and selling_unit='strip';
 v_items:=jsonb_build_array(jsonb_build_object('sale_item_id',v_line,'quantity',2,'restockable',true));
 v_result:=public.complete_sale_return(v_sale,v_items,'Owner accepts two sealed strips',gen_random_uuid());
 perform public.test_assert((select sum(base_quantity)=20 from public.return_allocations where return_item_id in(select id from public.return_items where return_id=(v_result->>'id')::uuid)),'strip return restores original base-unit conversion');
 select value into v_value from public.return_sales('Instant return fixture') value where value->>'id'=v_sale::text;
 perform public.test_assert((select (item->>'approved')::numeric=2 and (item->>'available')::numeric=1 from jsonb_array_elements(v_value->'sale_items') item where item->>'id'=v_line::text),'snapshot includes returns by every cashier');
 select id into v_line from public.sale_items where sale_id=v_sale and selling_unit='box';
 v_result:=public.complete_sale_return(v_sale,jsonb_build_array(jsonb_build_object('sale_item_id',v_line,'quantity',1,'restockable',true)),'Sealed box returned',gen_random_uuid());
 perform public.test_assert((select sum(base_quantity)=100 from public.return_allocations where return_item_id in(select id from public.return_items where return_id=(v_result->>'id')::uuid)),'box return restores exactly one hundred original tablets');
 perform public.test_assert((select count(*)=1 from public.audit_logs where action='complete_refund' and entity_id=v_result->>'id' and new_data->>'original_cashier'='20000000-0000-0000-0000-000000000002' and actor_id=auth.uid()),'audit records original sale cashier and returning cashier');
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
do $$
declare v_sale uuid:=(select id from public.test_ids where label='instant-staff-sale'); v_line uuid; v_items jsonb; v_key uuid:=gen_random_uuid(); v_result jsonb; v_value jsonb;
begin
 select value into v_value from public.return_sales('Instant return fixture') value where value->>'id'=v_sale::text;
 perform public.test_assert((select (item->>'approved')::numeric=2 from jsonb_array_elements(v_value->'sale_items') item where item->>'unit_label'='strip'),'Salesperson eligibility includes Owner refunds without broadening table RLS');
 select id into v_line from public.sale_items where sale_id=v_sale and selling_unit='base';
 perform public.complete_sale_return(v_sale,jsonb_build_array(jsonb_build_object('sale_item_id',v_line,'quantity',3,'restockable',false)),'Opened tablets, do not restock',gen_random_uuid());
 select id into v_line from public.sale_items where sale_id=v_sale and selling_unit='strip';
 v_items:=jsonb_build_array(jsonb_build_object('sale_item_id',v_line,'quantity',1,'restockable',false));
 perform public.test_denied(format('select public.complete_sale_return(%L,%L,%L,%L,''card'',false)',v_sale,v_items::text,'Manual card refund',v_key),'manual card refund requires confirmation');
 v_result:=public.complete_sale_return(v_sale,v_items,'Manual card refund',v_key,'card',true);
 perform public.test_assert((select kind='refund' and method='card' from public.payments where return_id=v_key),'confirmed external card refund is recorded without an integration');
 perform public.test_denied(format('select public.complete_sale_return(%L,%L,%L,%L)',v_sale,v_items::text,'Already returned strip',gen_random_uuid()),'distinct keys cannot exceed eligible quantities');
 perform public.test_assert((select count(*)=0 from public.return_sales('',null,11,0,(select id from public.test_ids where label='instant-owner-sale'))),'recent sale lookup preserves Salesperson scope');
 perform public.test_assert((select status='refunded' from public.sales where id=v_sale),'all completed returns update revenue and sale status');
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select public.test_assert((select sum(quantity_on_hand)=487 from public.medicine_batches where medicine_id=(select id from public.test_ids where label='instant-medicine')),'only resale-suitable units are restored; opened returns stay out of inventory');
select public.test_assert((select sum(refund_amount)=840 from public.sale_returns where sale_id=(select id from public.test_ids where label='instant-staff-sale')),'total instant refunds match original payment after discounts');
select public.test_assert((select count(*)=0 from public.return_sales('%')),'medicine and invoice search treats wildcard input literally');
select public.test_assert((select count(*)=0 from public.return_sales('', '1900-01-01')),'date filtering excludes sales outside the pharmacy date');
insert into public.test_ids select 'instant-legacy-sale',sale_id from public.checkout_sale(jsonb_build_array(
 jsonb_build_object('medicine_id',(select id from public.test_ids where label='instant-medicine'),'unit_key','base','quantity',3),
 jsonb_build_object('medicine_id',(select id from public.test_ids where label='instant-medicine'),'unit_key','strip','quantity',1)), 'cash',86,1,gen_random_uuid());
reset role;
update public.sale_items set net_line_total=null where sale_id=(select id from public.test_ids where label='instant-legacy-sale');
set local role authenticated;
do $$
declare v_sale uuid:=(select id from public.test_ids where label='instant-legacy-sale'); v_line uuid; v_snapshot jsonb; v_result jsonb;
begin
 select value into v_snapshot from public.return_sales('',null,11,0,v_sale) value;
 perform public.test_assert((select abs((item->>'net_line_total')::numeric-21::numeric*85/86)<0.00000001 from jsonb_array_elements(v_snapshot->'sale_items') item where item->>'unit_label'='tablet'),'legacy snapshot retains fractional-paisa invoice discount allocation');
 select id into v_line from public.sale_items where sale_id=v_sale and unit_label='tablet';
 v_result:=public.complete_sale_return(v_sale,jsonb_build_array(jsonb_build_object('sale_item_id',v_line,'quantity',2,'restockable',true)),'Legacy discounted tablets',gen_random_uuid());
 perform public.test_assert((v_result->>'refund')::numeric=13.84,'legacy partial refund uses original price and invoice discount');
 perform public.complete_sale_return(v_sale,jsonb_build_array(jsonb_build_object('sale_item_id',v_line,'quantity',1,'restockable',true)),'Remaining legacy tablet',gen_random_uuid());
 select id into v_line from public.sale_items where sale_id=v_sale and unit_label='strip';
 perform public.complete_sale_return(v_sale,jsonb_build_array(jsonb_build_object('sale_item_id',v_line,'quantity',1,'restockable',true)),'Legacy strip returned',gen_random_uuid());
 perform public.test_assert((select sum(refund_amount)=85 from public.sale_returns where sale_id=v_sale),'legacy cumulative refunds cannot exceed the original discounted payment');
end $$;
insert into public.test_ids select 'instant-stale-sale',sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='instant-medicine'),'unit_key','base','quantity',1)),'cash',7,0,gen_random_uuid());
reset role;
update public.medicine_batches set is_quarantined=true where medicine_id=(select id from public.test_ids where label='instant-medicine');
set local role authenticated;
select public.test_denied(format('select public.complete_sale_return(%L,%L,%L,%L)',(select id from public.test_ids where label='instant-stale-sale'),(select jsonb_build_array(jsonb_build_object('sale_item_id',id,'quantity',1,'restockable',true))::text from public.sale_items where sale_id=(select id from public.test_ids where label='instant-stale-sale')),'Quarantined stock',gen_random_uuid()),'quarantined original stock cannot be restored for resale');
select public.test_assert((select count(*)=0 from public.sale_returns where sale_id=(select id from public.test_ids where label='instant-stale-sale')),'failed restoration rolls back the whole refund');
reset role;
update public.medicine_batches set is_quarantined=false,expiry_date=(now() at time zone 'Asia/Karachi')::date-1 where medicine_id=(select id from public.test_ids where label='instant-medicine');
set local role authenticated;
select public.test_denied(format('select public.complete_sale_return(%L,%L,%L,%L)',(select id from public.test_ids where label='instant-stale-sale'),(select jsonb_build_array(jsonb_build_object('sale_item_id',id,'quantity',1,'restockable',true))::text from public.sale_items where sale_id=(select id from public.test_ids where label='instant-stale-sale')),'Expired stock',gen_random_uuid()),'expired original stock cannot be restored for resale');
select public.complete_sale_return((select id from public.test_ids where label='instant-stale-sale'),(select jsonb_build_array(jsonb_build_object('sale_item_id',id,'quantity',1,'restockable',false)) from public.sale_items where sale_id=(select id from public.test_ids where label='instant-stale-sale')),'Expired item refunded without restocking',gen_random_uuid());
reset role;
update public.profiles set is_active=false where id='20000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.test_denied($q$select public.return_sales()$q$,'inactive staff cannot look up recent sales');
select public.test_denied($q$select public.complete_sale_return(gen_random_uuid(),'[]','Inactive staff refund',gen_random_uuid())$q$,'inactive staff cannot complete refunds');
rollback;
