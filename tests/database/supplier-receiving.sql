-- This file runs only inside the disposable localhost contract database.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
insert into public.suppliers(id,name,created_by) values
  ('50000000-0000-4000-8000-000000000005','Saved supplier receiving fixture','10000000-0000-0000-0000-000000000001');
do $$
declare
  v_id uuid := (select id from public.test_ids where label='medicine');
  v_before numeric;
  v_result jsonb;
  v_retry jsonb;
  v_stock jsonb := '{"supplier_id":"50000000-0000-4000-8000-000000000005","unit_key":"box","quantity":1,"batch_number":"SUPPLIER-RECEIPT","expiry_date":"2099-12-25","total_cost":300}';
begin
  select sum(quantity_on_hand) into v_before from public.medicine_batches where medicine_id=v_id;
  v_result := public.receive_stock(v_id,v_stock,'a0000000-0000-4000-8000-000000000009');
  v_retry := public.receive_stock(v_id,v_stock,'a0000000-0000-4000-8000-000000000009');
  perform public.test_assert(v_result=v_retry,'supplier receipt retry returns the same purchase');
  perform public.test_assert((select supplier_id='50000000-0000-4000-8000-000000000005' and status='posted' and total=300 from public.purchases where id=(v_result->>'purchase_id')::uuid),'saved supplier is associated with the posted purchase');
  perform public.test_assert((select count(*)=1 and bool_and(b.supplier_id='50000000-0000-4000-8000-000000000005' and b.quantity_on_hand=100 and b.purchase_cost=3) from public.medicine_batches b join public.purchase_items pi on pi.id=b.purchase_item_id where pi.purchase_id=(v_result->>'purchase_id')::uuid),'saved supplier is associated with exactly one converted batch at its original cost');
  perform public.test_assert((select sum(quantity_on_hand)=v_before+100 from public.medicine_batches where medicine_id=v_id),'supplier selection leaves stock conversion unchanged');
  perform public.test_assert((select count(*)=1 from public.suppliers where name='Saved supplier receiving fixture'),'receiving does not duplicate the saved supplier');
end $$;
do $$
declare
 v_data jsonb := '{"name":"New medicine saved supplier fixture","dosage_form":"Tablet","strength":"500mg","barcode":"NEW-SAVED-SUPPLIER","tablets_per_strip":10,"strips_per_box":10,"units":[{"unit_key":"base","selling_price":7},{"unit_key":"strip","selling_price":65},{"unit_key":"box","selling_price":620}]}';
 v_stock jsonb := '{"supplier_id":"50000000-0000-4000-8000-000000000005","unit_key":"box","quantity":2,"batch_number":"INITIAL-SUPPLIER","expiry_date":"2099-12-25","total_cost":400}';
 v_key uuid := 'a0000000-0000-4000-8000-000000000010';
 v_result jsonb; v_retry jsonb; v_id uuid; v_purchase uuid;
begin
 v_result := public.save_guided_medicine(null,v_data,v_stock,v_key);
 v_retry := public.save_guided_medicine(null,v_data,v_stock,v_key);
 v_id := (v_result->>'id')::uuid;
 v_purchase := (v_result->>'purchase_id')::uuid;
 perform public.test_assert(v_retry->>'id'=v_result->>'id' and v_retry->>'quantity'=v_result->>'quantity','new medicine retry returns the original medicine and initial stock');
 perform public.test_assert((select count(*)=1 from public.medicines where barcode='NEW-SAVED-SUPPLIER'),'new medicine and retry create exactly one medicine');
 perform public.test_assert((select count(*)=1 and bool_and(p.supplier_id='50000000-0000-4000-8000-000000000005' and p.status='posted' and p.total=400) from public.purchases p join public.purchase_items pi on pi.purchase_id=p.id where pi.medicine_id=v_id),'initial purchase is recorded once against the selected supplier');
 perform public.test_assert((select received_unit='box' and received_quantity=2 and base_units_per_received_unit=100 and quantity=200 and unit_cost=2 and line_total=400 and batch_number='INITIAL-SUPPLIER' and expiry_date='2099-12-25' from public.purchase_items where purchase_id=v_purchase),'initial purchase retains quantity conversion, costs, batch and expiry');
 perform public.test_assert((select count(*)=1 and sum(quantity_on_hand)=200 and bool_and(supplier_id='50000000-0000-4000-8000-000000000005' and purchase_cost=2) from public.medicine_batches where medicine_id=v_id),'initial stock is added once with the saved supplier and cost');
 perform public.test_assert((select count(*)=1 from public.stock_receipts where request_key=v_key),'initial stock has one retry receipt');
 perform public.test_assert((select count(*)=1 and sum(quantity_delta)=200 from public.stock_movements where medicine_id=v_id and reference_type='purchase' and reference_id=v_purchase),'initial stock has one purchase movement');
 perform public.test_assert((select count(*)=1 from public.suppliers where id='50000000-0000-4000-8000-000000000005'),'creating medicine does not duplicate its supplier');
end $$;
select public.test_denied($q$select public.save_guided_medicine(null,
 '{"name":"Invalid supplier new medicine","dosage_form":"Syrup","barcode":"INVALID-NEW-SUPPLIER","units":[{"unit_key":"base","selling_price":7}]}',
 '{"supplier_id":"50000000-0000-4000-8000-999999999999","unit_key":"base","quantity":1,"batch_number":"INVALID","expiry_date":"2099-12-25","total_cost":10}',gen_random_uuid())$q$,'a nonexistent supplier ID cannot be used for initial stock');
select public.test_assert((select count(*)=0 from public.medicines where barcode='INVALID-NEW-SUPPLIER'),'invalid initial supplier rolls back medicine creation');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.test_assert((select count(*)=0 from public.suppliers),'suppliers remain Owner-only');
select public.test_denied($q$select public.save_guided_medicine(null,
 '{"name":"Unauthorized supplier medicine","dosage_form":"Syrup","units":[{"unit_key":"base","selling_price":7}]}',
 '{"supplier_id":"50000000-0000-4000-8000-000000000005","unit_key":"base","quantity":1,"batch_number":"DENIED","expiry_date":"2099-12-25","total_cost":10}',gen_random_uuid())$q$,'saved supplier selection cannot bypass Owner-only medicine creation');
select public.test_denied($q$select public.receive_stock((select id from public.test_ids where label='medicine'),'{"supplier_id":"50000000-0000-4000-8000-000000000005","unit_key":"box","quantity":1,"batch_number":"UNAUTHORIZED","expiry_date":"2099-12-25","total_cost":300}',gen_random_uuid())$q$,'a saved supplier ID cannot bypass Owner-only receiving');
rollback;
