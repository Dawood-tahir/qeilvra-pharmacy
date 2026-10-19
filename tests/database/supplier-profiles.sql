-- Run against the disposable contract database only. Preserve all production policies.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
insert into public.suppliers(id,name,created_by) values
 ('51000000-0000-4000-8000-000000000005','Profile history supplier','10000000-0000-0000-0000-000000000001'),
 ('51000000-0000-4000-8000-000000000006','Other profile supplier','10000000-0000-0000-0000-000000000001'),
 ('51000000-0000-4000-8000-000000000007','Empty profile supplier','10000000-0000-0000-0000-000000000001');
do $$
declare
 v_supplier uuid := '51000000-0000-4000-8000-000000000005';
 v_id uuid; v_purchase uuid; v_draft uuid; v_first uuid; v_restock uuid;
 v_today date := (now() at time zone 'Asia/Karachi')::date;
 v_result jsonb; v_available numeric; v_expiry_days integer;
begin
 v_result := public.save_guided_medicine(null,
  '{"name":"Supplier Profile medicine","dosage_form":"Tablet","strength":"500mg","barcode":"PROFILE-HISTORY","tablets_per_strip":10,"strips_per_box":10,"reorder_level":400,"units":[{"unit_key":"base","selling_price":7},{"unit_key":"strip","selling_price":65},{"unit_key":"box","selling_price":620}]}',
  jsonb_build_object('supplier_id',v_supplier,'unit_key','box','quantity',2,'batch_number','REPEAT','expiry_date',v_today+20,'total_cost',200),gen_random_uuid());
 v_id := (v_result->>'id')::uuid;
 v_first := (v_result->>'purchase_id')::uuid;
 v_result := public.receive_stock(v_id,jsonb_build_object('supplier_id',v_supplier,'unit_key','box','quantity',1,'batch_number','REPEAT','expiry_date',v_today+30,'total_cost',300),gen_random_uuid());
 v_restock := (v_result->>'purchase_id')::uuid;
 v_purchase := public.create_purchase(jsonb_build_object('supplier_id',v_supplier,'supplier_invoice_number','PROFILE-REF','invoice_date',v_today-1,'discount',10),
  jsonb_build_array(jsonb_build_object('medicine_id',v_id,'unit_key','strip','quantity',2,'unit_cost',100,'batch_number','REPEAT','expiry_date',v_today+40)));
 perform public.post_purchase(v_purchase);
 v_draft := public.create_purchase(jsonb_build_object('supplier_id',v_supplier,'invoice_date',v_today),
  jsonb_build_array(jsonb_build_object('medicine_id',v_id,'unit_key','box','quantity',1,'unit_cost',999,'batch_number','DRAFT','expiry_date',v_today+40)));
 perform public.receive_stock(v_id,jsonb_build_object('supplier_id','51000000-0000-4000-8000-000000000006','unit_key','strip','quantity',1,'batch_number','OTHER','expiry_date',v_today+100,'total_cost',500),gen_random_uuid());
 perform public.receive_stock(v_id,jsonb_build_object('unit_key','strip','quantity',1,'batch_number','UNASSIGNED','expiry_date',v_today+100,'total_cost',400),gen_random_uuid());
 perform public.test_assert((select count(*)=3 and sum(total)=690 and max(invoice_date)=v_today from public.purchases where supplier_id=v_supplier and status='posted'),'all receiving workflows contribute once; drafts, other suppliers and unassigned receipts are excluded');
 perform public.test_assert((select count(*)=1 and sum(total)=999 from public.purchases where supplier_id=v_supplier and status='draft'),'draft history is retained separately');
 perform public.test_assert((select count(*)=3 and count(distinct pi.medicine_id)=1 and sum(pi.quantity)=320 and sum(pi.line_total)=700 from public.purchase_items pi join public.purchases p on p.id=pi.purchase_id where p.supplier_id=v_supplier and p.status='posted'),'repeated deliveries keep separate lines and invoice discount does not alter line totals');
 perform public.test_assert((select count(*)=3 from public.medicine_batches where supplier_id=v_supplier and medicine_id=v_id and batch_number='REPEAT'),'repeated manufacturer batches remain separate stock receipts');
 perform public.test_assert((select received_quantity=2 and received_unit='box' and quantity=200 and base_units_per_received_unit=100 and unit_cost*base_units_per_received_unit=100 from public.purchase_items where purchase_id=v_first),'initial stock preserves boxes, conversion and cost');
 perform public.test_assert((select received_quantity=1 and received_unit='box' and quantity=100 from public.purchase_items where purchase_id=v_restock),'Add More Stock preserves its distinct receipt');
 perform public.test_assert((select received_quantity=2 and received_unit='strip' and quantity=20 and base_units_per_received_unit=10 and unit_cost*base_units_per_received_unit=100 and expiry_date=v_today+40 from public.purchase_items where purchase_id=v_purchase),'Purchases preserves strips, date, expiry and cost');
 perform public.test_assert((select supplier_invoice_number='PROFILE-REF' and invoice_date=v_today-1 and total=190 from public.purchases where id=v_purchase),'supplier invoice reference and discounted total are saved');
 select (value->>'available_quantity')::numeric into v_available from public.inventory_search('PROFILE-HISTORY') value;
 perform public.test_assert(v_available=340,'availability includes stock from other suppliers and unassigned receipts');
 perform public.test_assert((select available_quantity=340 and reorder_level=400 from public.inventory_alerts('low_stock',100) where medicine_id=v_id),'supplier stock eligibility matches existing low stock RPC');
 select expiry_alert_days into v_expiry_days from public.pharmacy_settings where id;
 perform public.test_assert((select expiry_date=v_today+20 from public.inventory_alerts('expiring',100) where medicine_id=v_id),'existing configured expiry warning uses nearest eligible batch');
 perform public.test_assert((select count(*)=0 from public.purchases where supplier_id='51000000-0000-4000-8000-000000000007'),'empty supplier has no inferred purchases');
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.test_assert((select count(*)=0 from public.suppliers),'Salesperson cannot read supplier profiles');
select public.test_assert((select count(*)=0 from public.purchases),'Salesperson cannot read supplier financial history');
select public.test_assert((select count(*)=0 from public.purchase_items),'Salesperson cannot read receipt costs');
select public.test_assert((select count(*)=0 from public.medicine_batches),'Salesperson cannot read batch costs');
rollback;
