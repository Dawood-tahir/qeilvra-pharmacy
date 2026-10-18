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
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.test_assert((select count(*)=0 from public.suppliers),'suppliers remain Owner-only');
select public.test_denied($q$select public.receive_stock((select id from public.test_ids where label='medicine'),'{"supplier_id":"50000000-0000-4000-8000-000000000005","unit_key":"box","quantity":1,"batch_number":"UNAUTHORIZED","expiry_date":"2099-12-25","total_cost":300}',gen_random_uuid())$q$,'a saved supplier ID cannot bypass Owner-only receiving');
rollback;
