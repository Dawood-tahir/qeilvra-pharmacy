begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
create temporary table pos_financial_before as select public.owner_dashboard_metrics((now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date) value;
insert into public.test_ids select 'pos-medicine',(public.save_guided_medicine(null,
 '{"name":"POS final fixture","dosage_form":"Tablet","barcode":"POS-FINAL","tablets_per_strip":12,"strips_per_box":5,"units":[{"unit_key":"base","selling_price":10},{"unit_key":"strip","selling_price":100},{"unit_key":"box","selling_price":500}]}',
 '{"unit_key":"box","quantity":10,"batch_number":"POS-FINAL","expiry_date":"2099-12-25","total_cost":1200}',gen_random_uuid())->>'id')::uuid;
insert into public.test_ids select 'pos-sale',sale_id from public.checkout_sale(jsonb_build_array(
 jsonb_build_object('medicine_id',(select id from public.test_ids where label='pos-medicine'),'unit_key','strip','quantity',2,'expected_price',100,'line_discount',20),
 jsonb_build_object('medicine_id',(select id from public.test_ids where label='pos-medicine'),'unit_key','box','quantity',1,'expected_price',500,'line_discount',50)),
 'cash',700,30,'aa000000-0000-4000-8000-000000000012',null,null,25,'Delivery');
select public.test_assert((select subtotal=700 and discount=100 and extra_charge_amount=25 and net_total=625 and extra_charge_description='Delivery' from public.sales where id=(select id from public.test_ids where label='pos-sale')),'gross inventory prices minus item and bill discounts plus extra charge are stored once');
select public.test_assert((select sum(line_total)=700 and sum(item_discount)=70 and sum(net_line_total)=600 from public.sale_items where sale_id=(select id from public.test_ids where label='pos-sale')),'line medicine revenue excludes extra charges and accounts for discounts once');
select public.test_assert((select amount=625 and tendered_amount=700 and change_amount=75 from public.payments where sale_id=(select id from public.test_ids where label='pos-sale')),'cash payment and change use the exact final charge');
select public.test_assert((select sum(quantity_on_hand)=516 from public.medicine_batches where medicine_id=(select id from public.test_ids where label='pos-medicine')),'discounts and charges preserve pack stock deductions');
select public.test_denied($q$select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='pos-medicine'),'quantity',1,'custom_price',1)),'cash',100,0,gen_random_uuid())$q$,'custom POS prices cannot bypass Inventory prices through direct RPC');
select public.test_denied($q$select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='pos-medicine'),'quantity',1)),'cash',100,0,gen_random_uuid(),null,null,-1)$q$,'negative extra charge is rejected atomically');
select public.test_denied($q$select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='pos-medicine'),'quantity',1)),'cash',100,0,gen_random_uuid(),null,null,'NaN')$q$,'nonfinite extra charge is rejected');
select public.test_denied($q$select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='pos-medicine'),'quantity',1,'line_discount',11)),'cash',100,0,gen_random_uuid())$q$,'item discount cannot exceed original line price');
do $$
declare v_sale uuid:=(select id from public.test_ids where label='pos-sale'); v_line uuid; v_key uuid:=gen_random_uuid(); v_items jsonb; v_result jsonb; v_retry jsonb; v_snapshot jsonb; v_refund numeric; v_before numeric; v_after numeric; v_metrics jsonb;
begin
 select id into v_line from public.sale_items where sale_id=v_sale and selling_unit='strip';
 v_items:=jsonb_build_array(jsonb_build_object('sale_item_id',v_line,'quantity',1,'restockable',true,'in_base_units',true));
 v_result:=public.complete_sale_return(v_sale,v_items,'One tablet from a twelve tablet strip',v_key);
 v_retry:=public.complete_sale_return(v_sale,v_items,'One tablet from a twelve tablet strip',v_key);
 perform public.test_assert(v_retry=v_result and (v_result->>'refund')::numeric=7.14,'one tablet refunds the original discounted pack price with cumulative rounding');
 perform public.test_assert((select sum(ra.base_quantity)=1 from public.return_allocations ra join public.return_items ri on ri.id=ra.return_item_id where ri.return_id=v_key),'exactly one tablet is restocked once');
 perform public.test_assert((select count(*)=1 from public.payments where return_id=v_key),'tablet retry cannot duplicate a refund');
 select value into v_snapshot from public.return_sales('',null,11,0,v_sale) value;
 perform public.test_assert((select (i->>'approved_base_quantity')::numeric=1 and (i->>'available_base_quantity')::numeric=23 from jsonb_array_elements(v_snapshot->'sale_items') i where i->>'id'=v_line::text),'lookup reports exact remaining base quantities after fractional pack return');
 perform public.complete_sale_return(v_sale,jsonb_build_array(jsonb_build_object('sale_item_id',v_line,'quantity',23,'restockable',false,'in_base_units',true)),'Remaining opened tablets',gen_random_uuid());
 select id into v_line from public.sale_items where sale_id=v_sale and selling_unit='box';
 v_result:=public.complete_sale_return(v_sale,jsonb_build_array(jsonb_build_object('sale_item_id',v_line,'quantity',1,'restockable',true,'in_base_units',true)),'One tablet from the original box',gen_random_uuid());
 perform public.test_assert((v_result->>'refund')::numeric=7.14,'single-tablet box refund uses the original discounted box price');
 perform public.complete_sale_return(v_sale,jsonb_build_array(jsonb_build_object('sale_item_id',v_line,'quantity',59,'restockable',true,'in_base_units',true)),'Remaining sealed tablets from box',gen_random_uuid());
 perform public.test_assert((select sum(refund_amount)=600 and bool_and(status='approved') from public.sale_returns where sale_id=v_sale),'all medicine refunds total original discounted medicine revenue and retain unrelated extra charge');
 perform public.test_assert((select status='refunded' from public.sales where id=v_sale),'all medicines returned is refunded even when an extra charge is retained');
 perform public.test_assert((select sum(quantity_on_hand)=577 from public.medicine_batches where medicine_id=(select id from public.test_ids where label='pos-medicine')),'opened tablets stay out of stock while sealed box and one tablet return once');
 perform public.test_denied(format('select public.complete_sale_return(%L,%L,%L,%L)',v_sale,v_items::text,'Duplicate returned tablet',gen_random_uuid()),'distinct keys cannot return refunded tablets again');
 v_metrics:=public.owner_dashboard_metrics((now() at time zone 'Asia/Karachi')::date,(now() at time zone 'Asia/Karachi')::date);
 perform public.test_assert((v_metrics->>'extra_charge_revenue')::numeric>=25,'reports expose extra charge revenue separately');
 perform public.test_assert((v_metrics->>'revenue')::numeric=(v_metrics->>'medicine_revenue')::numeric+(v_metrics->>'extra_charge_revenue')::numeric,'medicine and extra charge revenue reconcile');
 perform public.test_assert((v_metrics->>'revenue')::numeric=(select (value->>'revenue')::numeric+25 from pos_financial_before),'only the retained extra charge remains in net revenue after all medicines are refunded');
 perform public.test_assert((v_metrics->>'gross_profit')::numeric=(select (value->>'gross_profit')::numeric-21 from pos_financial_before),'profit retains extra revenue and the cost of 23 nonresale tablets, without creating COGS for charges');
 perform public.owner_report_breakdowns(current_date-1,current_date+1);
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.test_denied($q$select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='pos-medicine'),'quantity',1,'line_discount',0.5)),'card',null,0.01,gen_random_uuid(),null,null,100)$q$,'extra charge cannot dilute the combined salesperson discount limit');
insert into public.test_ids select 'pos-staff-card',sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='pos-medicine'),'quantity',2,'line_discount',1)),'card',null,0,gen_random_uuid(),null,null,3,'Service');
select public.test_assert((select method='card' and amount=22 and tendered_amount is null from public.payments where sale_id=(select id from public.test_ids where label='pos-staff-card')),'card checkout records medicine discount plus charge');
select public.complete_sale_return((select id from public.test_ids where label='pos-staff-card'),(select jsonb_build_array(jsonb_build_object('sale_item_id',id,'quantity',1,'restockable',true)) from public.sale_items where sale_id=(select id from public.test_ids where label='pos-staff-card')),'Cashier returns one tablet immediately',gen_random_uuid());
select public.test_assert((select refund_amount=9.5 and status='approved' and requested_by=reviewed_by from public.sale_returns where sale_id=(select id from public.test_ids where label='pos-staff-card')),'Salesperson direct return uses original discounted amount without approval');
select public.test_assert((select count(*)>0 from public.return_sales()),'recent completed sales load for active salesperson');
reset role;
update public.profiles set is_active=false where id='20000000-0000-0000-0000-000000000002';
set local role authenticated;
select public.test_denied($q$select public.return_sales()$q$,'upgraded lookup rejects inactive staff');
select public.test_denied($q$select public.complete_sale_return(gen_random_uuid(),'[]','Inactive return attempt',gen_random_uuid())$q$,'upgraded direct refund rejects inactive staff');
select public.test_denied($q$select * from public.checkout_sale('[]','cash',0,0,gen_random_uuid(),null,null,10)$q$,'upgraded checkout rejects inactive staff');
rollback;
