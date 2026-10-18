-- Plain PostgreSQL assertions, run in a disposable database by scripts/test-database.mjs.
create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function public.test_denied(statement text,label text) returns void language plpgsql as $$
begin
 begin execute statement; exception when others then raise notice 'PASS: % (%)',label,sqlerrm; return; end;
 raise exception 'FAIL: % was allowed',label;
end $$;
insert into auth.users values ('10000000-0000-0000-0000-000000000001','owner@test.local'),('20000000-0000-0000-0000-000000000002','sales@test.local');
insert into public.profiles(id,full_name) values ('10000000-0000-0000-0000-000000000001','Test Owner'),('20000000-0000-0000-0000-000000000002','Test Salesperson');
insert into public.user_roles(user_id,role) values ('10000000-0000-0000-0000-000000000001','owner'),('20000000-0000-0000-0000-000000000002','salesperson');
create table public.test_ids(label text primary key,id uuid);
grant select,insert on public.test_ids to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
insert into public.test_ids select 'medicine',(public.save_guided_medicine(null,
 '{"name":"Paracetamol","dosage_form":"Tablet","strength":"500mg","barcode":"TEST-PC","tablets_per_strip":10,"strips_per_box":10,"units":[{"unit_key":"base","selling_price":7,"max_price":7},{"unit_key":"strip","selling_price":65},{"unit_key":"box","selling_price":620}]}',
 '{"unit_key":"box","quantity":2,"batch_number":"FIRST","expiry_date":"2098-12-25","total_cost":400}',
 'aaaaaaaa-0000-0000-0000-000000000001')->>'id')::uuid;
select public.test_assert((select sum(quantity_on_hand)=200 from public.medicine_batches),'two boxes add 200 tablets');
select public.test_assert((select purchase_cost=2 from public.medicine_batches limit 1),'actual purchased base cost recorded');
select public.test_assert((select count(*)=3 from public.medicine_units),'independent selling-unit prices saved');
select public.test_denied($q$select public.save_guided_medicine(null,
 '{"name":"Paracetamol","dosage_form":"Tablet","strength":"500mg","tablets_per_strip":10,"strips_per_box":10,"units":[{"unit_key":"base","selling_price":7}]}',
 '{"unit_key":"box","quantity":2,"batch_number":"DUP","expiry_date":"2098-12-25","total_cost":400}',gen_random_uuid())$q$,'duplicate catalogue entry rejected');
select public.test_denied($q$select public.save_guided_medicine(null,
 '{"name":"MRP Test","dosage_form":"Syrup","units":[{"unit_key":"base","selling_price":20,"max_price":10}]}',
 '{"unit_key":"base","quantity":1,"batch_number":"MRP","expiry_date":"2098-12-25","total_cost":5}',gen_random_uuid())$q$,'selling-price limit enforced');
select public.test_denied($q$select public.save_guided_medicine(null,
 '{"name":"Invalid Syrup","dosage_form":"Syrup","tablets_per_strip":10,"units":[{"unit_key":"base","selling_price":20},{"unit_key":"strip","selling_price":100}]}',
 '{"unit_key":"base","quantity":1,"batch_number":"SYR","expiry_date":"2098-12-25","total_cost":5}',gen_random_uuid())$q$,'sealed products cannot have strips');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',false);
select public.test_assert((select count(*)=0 from public.medicine_batches),'salesperson cannot read batch costs');
select public.test_assert((select count(*)=0 from public.medicine_costs),'salesperson cannot read default costs');
select public.test_denied($q$update public.medicine_units set selling_price=1$q$,'salesperson cannot edit selling prices');
select public.test_denied($q$update public.medicines set selling_price=1$q$,'salesperson cannot bypass master price RPC');
select public.test_denied($q$select public.receive_stock((select id from public.test_ids where label='medicine'),
 '{"unit_key":"base","quantity":1,"batch_number":"BAD","expiry_date":"2098-12-25","total_cost":0}',gen_random_uuid())$q$,'salesperson cannot receive stock');
select public.test_denied($q$select public.adjust_stock(gen_random_uuid(),1,'tamper')$q$,'salesperson cannot change stock');
select public.test_denied($q$select public.owner_dashboard_metrics(current_date,current_date)$q$,'salesperson cannot read profit reports');
select public.test_denied($q$select public.review_sale_return(gen_random_uuid(),true,'[]',null,'cash')$q$,'salesperson cannot authorize returns');
insert into public.test_ids select 'sale-tablet',sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='medicine'),'unit_key','base','quantity',1,'expected_price',7)),'cash',7,0,'bbbbbbbb-0000-0000-0000-000000000001');
select public.test_assert((select available_quantity=199 from public.search_sellable_medicines('TEST-PC')),'one tablet deducts one tablet');
insert into public.test_ids select 'sale-strip',sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='medicine'),'unit_key','strip','quantity',1)),'cash',65,0,'bbbbbbbb-0000-0000-0000-000000000002');
select public.test_assert((select available_quantity=189 from public.search_sellable_medicines('TEST-PC')),'one strip deducts ten tablets');
insert into public.test_ids select 'sale-box',sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='medicine'),'unit_key','box','quantity',1)),'cash',620,0,'bbbbbbbb-0000-0000-0000-000000000003');
select public.test_assert((select available_quantity=89 from public.search_sellable_medicines('TEST-PC')),'one box deducts one hundred tablets');
select public.test_assert((select unit_label='box' and quantity=1 and base_quantity=100 and unit_price=620 from public.sale_items where sale_id=(select id from public.test_ids where label='sale-box')),'receipt preserves selling unit quantity conversion and price');
select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='medicine'),'unit_key','box','quantity',1)),'cash',620,0,'bbbbbbbb-0000-0000-0000-000000000003');
select public.test_assert((select count(*)=3 from public.sales),'checkout retry creates no duplicate');
select public.test_denied($q$select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='medicine'),'unit_key','box','quantity',1)),'cash',620,0,gen_random_uuid())$q$,'insufficient stock rejected');
select public.test_denied($q$select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='medicine'),'unit_key','base','quantity',0.5)),'cash',620,0,gen_random_uuid())$q$,'fractional tablet rejected');
select public.test_denied($q$select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='medicine'),'unit_key','base','quantity',1,'expected_price',1)),'cash',620,0,gen_random_uuid())$q$,'stale or tampered price cannot affect sale');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
select public.test_assert((public.owner_dashboard_metrics(current_date,current_date)->>'gross_profit')::numeric=470,'profit uses actual purchased costs: 692 minus 222');
select public.receive_stock((select id from public.test_ids where label='medicine'),'{"unit_key":"box","quantity":1,"batch_number":"FIRST","expiry_date":"2099-12-25","total_cost":300}','aaaaaaaa-0000-0000-0000-000000000002');
select public.receive_stock((select id from public.test_ids where label='medicine'),'{"unit_key":"box","quantity":1,"batch_number":"FIRST","expiry_date":"2099-12-25","total_cost":300}','aaaaaaaa-0000-0000-0000-000000000002');
select public.test_assert((select available_quantity=189 from public.search_sellable_medicines('TEST-PC')),'restocking retry adds 100 only once');
select public.test_assert((select count(*)=1 from public.medicines),'restocking does not duplicate medicine');
select public.test_assert((select count(*)=2 and min(expiry_date)='2098-12-25' and max(expiry_date)='2099-12-25' from public.medicine_batches),'repeated batch number preserves both receipt expiries');
insert into public.test_ids select 'mixed',sale_id from public.checkout_sale(jsonb_build_array(
 jsonb_build_object('medicine_id',(select id from public.test_ids where label='medicine'),'unit_key','base','quantity',1),
 jsonb_build_object('medicine_id',(select id from public.test_ids where label='medicine'),'unit_key','strip','quantity',1),
 jsonb_build_object('medicine_id',(select id from public.test_ids where label='medicine'),'unit_key','box','quantity',1)),'cash',692,0,gen_random_uuid());
select public.test_assert((select net_total=692 from public.sales where id=(select id from public.test_ids where label='mixed')),'mixed independent prices total 692');
select public.test_assert((select sum(base_quantity)=111 and count(*)=3 from public.sale_items where sale_id=(select id from public.test_ids where label='mixed')),'same medicine mixed units remain three invoice lines');
select public.test_assert((select quantity_on_hand=0 from public.medicine_batches where expiry_date='2098-12-25'),'FEFO consumes earlier batch first');
select public.test_assert((select sum(quantity*unit_cost)=244 from public.sale_item_costs where sale_item_id in (select id from public.sale_items where sale_id=(select id from public.test_ids where label='mixed'))),'mixed batches retain actual COGS: 89 at 2 and 22 at 3');
insert into public.test_ids select 'return',public.request_sale_return((select id from public.test_ids where label='mixed'),
 (select jsonb_agg(jsonb_build_object('sale_item_id',id,'quantity',quantity)) from public.sale_items where sale_id=(select id from public.test_ids where label='mixed')),'Customer returned unopened medicine');
select public.review_sale_return((select id from public.test_ids where label='return'),true,
 (select jsonb_agg(jsonb_build_object('return_item_id',id,'approved_quantity',quantity,'restockable',true)) from public.return_items where return_id=(select id from public.test_ids where label='return')),null,'cash');
select public.test_assert((select available_quantity=189 from public.search_sellable_medicines('TEST-PC')),'authorized returns restore original base quantities');
select public.test_assert((select sum(base_quantity*unit_cost)=244 from public.return_allocations),'return cost reverses exact original allocations');
select public.test_assert((select refund_amount=692 from public.sale_returns where id=(select id from public.test_ids where label='return')),'refund reverses charged selling-unit prices');
select public.test_assert((public.owner_dashboard_metrics(current_date,current_date)->>'gross_profit')::numeric=470,'profit restored after complete saleable return');
select public.test_denied($q$select public.review_sale_return((select id from public.test_ids where label='return'),true,'[]',null,'cash')$q$,'return cannot be approved twice');
-- Disposable fixture for concurrent processes.
select public.receive_stock((select id from public.test_ids where label='medicine'),'{"unit_key":"base","quantity":1,"batch_number":"EXPIRED","expiry_date":"2099-12-25","total_cost":1}',gen_random_uuid());
reset role;
update public.medicine_batches set expiry_date=current_date-1 where batch_number='EXPIRED';
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
insert into public.test_ids select 'syrup',(public.save_guided_medicine(null,'{"name":"Whole Syrup","dosage_form":"Syrup","barcode":"TEST-SYR","units":[{"unit_key":"base","selling_price":150}]}',
 '{"unit_key":"base","quantity":1,"batch_number":"LAST","expiry_date":"2099-12-25","total_cost":70}',gen_random_uuid())->>'id')::uuid;
select public.test_denied($q$select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='syrup'),'unit_key','base','quantity',0.5)),'cash',150,0,gen_random_uuid())$q$,'fractional bottle rejected');
select public.test_denied($q$select * from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='syrup'),'unit_key','strip','quantity',1)),'cash',150,0,gen_random_uuid())$q$,'bottle cannot be sold as strip');
reset role;
