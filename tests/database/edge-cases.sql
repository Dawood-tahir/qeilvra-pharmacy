set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
-- A medicine with only an expired batch must never reach a completed sale.
insert into public.test_ids select 'expired',(public.save_guided_medicine(null,'{"name":"Expired Only","dosage_form":"Cream","units":[{"unit_key":"base","selling_price":30}]}',
 '{"unit_key":"base","quantity":1,"batch_number":"EXP","expiry_date":"2099-01-01","total_cost":10}',gen_random_uuid())->>'id')::uuid;
reset role;
update public.medicine_batches set expiry_date=current_date-1 where medicine_id=(select id from public.test_ids where label='expired');
set role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',false);
select public.test_denied($q$select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='expired'),'unit_key','base','quantity',1)),'cash',30,0,gen_random_uuid())$q$,'expired-only stock rejected');
select public.test_assert((select available_quantity=0 from public.search_sellable_medicines('Expired Only')),'expired stock excluded from availability');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
-- Two partial returns across batch boundaries must consume different original allocations.
insert into public.test_ids select 'partial-sale',sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='medicine'),'unit_key','strip','quantity',2)),'cash',130,0,gen_random_uuid());
insert into public.test_ids select 'partial-return-1',public.request_sale_return((select id from public.test_ids where label='partial-sale'),(select jsonb_agg(jsonb_build_object('sale_item_id',id,'quantity',1)) from public.sale_items where sale_id=(select id from public.test_ids where label='partial-sale')),'Unopened strip');
select public.test_denied($q$select public.review_sale_return((select id from public.test_ids where label='partial-return-1'),true,
 (select jsonb_agg(x) from (select jsonb_build_object('return_item_id',id,'approved_quantity',1,'restockable',true) x from public.return_items where return_id=(select id from public.test_ids where label='partial-return-1') union all select jsonb_build_object('return_item_id',id,'approved_quantity',1,'restockable',true) from public.return_items where return_id=(select id from public.test_ids where label='partial-return-1')) d),null,'cash')$q$,'duplicate approval rows cannot double-refund');
select public.review_sale_return((select id from public.test_ids where label='partial-return-1'),true,(select jsonb_agg(jsonb_build_object('return_item_id',id,'approved_quantity',1,'restockable',true)) from public.return_items where return_id=(select id from public.test_ids where label='partial-return-1')),null,'cash');
insert into public.test_ids select 'partial-return-2',public.request_sale_return((select id from public.test_ids where label='partial-sale'),(select jsonb_agg(jsonb_build_object('sale_item_id',id,'quantity',1)) from public.sale_items where sale_id=(select id from public.test_ids where label='partial-sale')),'Second unopened strip');
select public.review_sale_return((select id from public.test_ids where label='partial-return-2'),true,(select jsonb_agg(jsonb_build_object('return_item_id',id,'approved_quantity',1,'restockable',true)) from public.return_items where return_id=(select id from public.test_ids where label='partial-return-2')),null,'cash');
select public.test_assert((select sum(ra.base_quantity)=20 from public.return_allocations ra join public.return_items ri on ri.id=ra.return_item_id where ri.return_id in (select id from public.test_ids where label like 'partial-return-%')),'multiple partial returns restore exactly 20 tablets');
select public.test_assert(not exists(select 1 from public.return_allocations ra group by ra.sale_item_cost_id having sum(ra.base_quantity)>(select quantity from public.sale_item_costs where id=ra.sale_item_cost_id)),'original return allocations are never reused');
-- Purchases use selected units, preserve receipt expiry, and allocate invoice discount into COGS.
insert into public.suppliers(id,name,created_by) values('dddddddd-0000-0000-0000-000000000001','Test supplier','10000000-0000-0000-0000-000000000001');
insert into public.test_ids select 'purchase',public.create_purchase('{"supplier_id":"dddddddd-0000-0000-0000-000000000001","discount":20}',jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='medicine'),'unit_key','box','quantity',2,'unit_cost',200,'batch_number','INVOICE','expiry_date','2099-01-01')));
select public.test_assert((select quantity=200 and received_quantity=2 and received_unit='box' and line_total=400 from public.purchase_items where purchase_id=(select id from public.test_ids where label='purchase')),'purchase box quantity converted once');
select public.post_purchase((select id from public.test_ids where label='purchase'));
select public.test_assert((select quantity_on_hand=200 and purchase_cost=1.9 from public.medicine_batches where batch_number='INVOICE'),'purchase invoice discount is reflected in actual batch cost');
select public.test_denied($q$select public.post_purchase((select id from public.test_ids where label='purchase'))$q$,'purchase cannot be posted twice');
select public.test_assert(not exists(select 1 from public.inventory_search('',20,0,'low_stock','name') j where (j->>'available_quantity')::numeric>(j->>'reorder_level')::numeric),'low stock filter applies before pagination');
select public.test_assert((select j->>'id' from public.inventory_search('',1,0,'all','name') j)<>(select j->>'id' from public.inventory_search('',1,1,'all','name') j),'inventory pagination yields distinct medicines');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
insert into public.test_ids select 'variable-pack',(public.save_guided_medicine(null,'{"name":"Variable Capsule","dosage_form":"Capsule","tablets_per_strip":7,"strips_per_box":3,"units":[{"unit_key":"base","selling_price":3},{"unit_key":"strip","selling_price":20},{"unit_key":"box","selling_price":58}]}','{"unit_key":"box","quantity":2,"batch_number":"SEVENS","expiry_date":"2099-12-31","total_cost":42}',gen_random_uuid())->>'id')::uuid;
select public.test_assert((select available_quantity=42 from public.search_sellable_medicines('Variable Capsule')),'pack conversion supports seven capsules per strip and three strips per box');
select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='variable-pack'),'unit_key','box','quantity',1)),'cash',58,0,gen_random_uuid());
select public.test_assert((select available_quantity=21 from public.search_sellable_medicines('Variable Capsule')),'variable pack box deducts exactly 21 capsules');

-- Full refunds of discounted mixed lines must total the exact paid amount, even with rounding.
insert into public.test_ids select 'rounding-'||n,(public.save_guided_medicine(null,
 jsonb_build_object('name','Rounding Syrup '||n,'dosage_form','Syrup','units',jsonb_build_array(jsonb_build_object('unit_key','base','selling_price',0.01))),
 '{"unit_key":"base","quantity":1,"batch_number":"ROUND","expiry_date":"2099-12-31","total_cost":0}',gen_random_uuid())->>'id')::uuid from generate_series(1,3) n;
insert into public.test_ids select 'rounding-sale',sale_id from public.checkout_sale((select jsonb_agg(jsonb_build_object('medicine_id',id,'unit_key','base','quantity',1)) from public.test_ids where label like 'rounding-%'),'cash',0.02,0.01,gen_random_uuid());
select public.test_assert((select sum(net_line_total)=0.02 from public.sale_items where sale_id=(select id from public.test_ids where label='rounding-sale')),'discount rounding snapshots sum to exact paid amount');
insert into public.test_ids select 'rounding-return',public.request_sale_return((select id from public.test_ids where label='rounding-sale'),(select jsonb_agg(jsonb_build_object('sale_item_id',id,'quantity',1)) from public.sale_items where sale_id=(select id from public.test_ids where label='rounding-sale')),'Unopened items returned');
select public.review_sale_return((select id from public.test_ids where label='rounding-return'),true,(select jsonb_agg(jsonb_build_object('return_item_id',id,'approved_quantity',1,'restockable',true)) from public.return_items where return_id=(select id from public.test_ids where label='rounding-return')),null,'cash');
select public.test_assert((select refund_amount=0.02 from public.sale_returns where id=(select id from public.test_ids where label='rounding-return')),'full refund cannot over-refund discounted mixed lines');

create temp table profit_before as select (public.owner_dashboard_metrics(current_date,current_date)->>'gross_profit')::numeric amount;
insert into public.test_ids select 'damaged',(public.save_guided_medicine(null,'{"name":"Damaged Syrup","dosage_form":"Syrup","units":[{"unit_key":"base","selling_price":10}]}','{"unit_key":"base","quantity":1,"batch_number":"DMG","expiry_date":"2099-12-31","total_cost":6}',gen_random_uuid())->>'id')::uuid;
insert into public.test_ids select 'damaged-sale',sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='damaged'),'unit_key','base','quantity',1)),'cash',10,0,gen_random_uuid());
insert into public.test_ids select 'damaged-return',public.request_sale_return((select id from public.test_ids where label='damaged-sale'),(select jsonb_agg(jsonb_build_object('sale_item_id',id,'quantity',1)) from public.sale_items where sale_id=(select id from public.test_ids where label='damaged-sale')),'Damaged bottle cannot be resold');
select public.review_sale_return((select id from public.test_ids where label='damaged-return'),true,(select jsonb_agg(jsonb_build_object('return_item_id',id,'approved_quantity',1,'restockable',false)) from public.return_items where return_id=(select id from public.test_ids where label='damaged-return')),null,'cash');
select public.test_assert((public.owner_dashboard_metrics(current_date,current_date)->>'gross_profit')::numeric=(select amount-6 from profit_before),'non-saleable return retains actual inventory loss in profit');
select public.test_assert((select available_quantity=0 from public.search_sellable_medicines('Damaged Syrup')),'non-saleable return never increases stock');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
select public.correct_stock((select id from public.medicine_batches where medicine_id=(select id from public.test_ids where label='variable-pack')),22,21,'Physical count verified');
select public.test_assert((select quantity_on_hand=22 from public.medicine_batches where medicine_id=(select id from public.test_ids where label='variable-pack')),'Owner physical count corrects stock in whole items');
select public.test_denied($q$select public.correct_stock((select id from public.medicine_batches where medicine_id=(select id from public.test_ids where label='variable-pack')),23,21,'Stale physical count')$q$,'stale physical count cannot overwrite concurrent stock changes');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',false);
select public.test_denied($q$select public.correct_stock(gen_random_uuid(),2,1,'Unauthorized count')$q$,'salesperson cannot correct physical stock');
reset role;
