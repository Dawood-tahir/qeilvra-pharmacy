-- Local disposable contract database only. Every Manager fixture rolls back.
begin;
reset role;
insert into auth.users(id,email) values('30000000-0000-4000-8000-000000000003','manager@example.test');
insert into public.profiles(id,full_name) values('30000000-0000-4000-8000-000000000003','Test Manager');
insert into public.user_roles(user_id,role) values('30000000-0000-4000-8000-000000000003','manager');
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
select public.test_assert(public.current_role()='manager' and public.is_active_staff() and public.can_manage_operations() and not public.is_owner(),'Manager is active operations staff and never Owner');
select public.test_assert((select count(*)=4 from jsonb_object_keys(public.manager_dashboard())),'Manager dashboard exposes only four stock indicators');
select public.test_assert(not (public.manager_dashboard() ?| array['revenue','profit','gross_profit','expenses','today_sales','purchases']),'Manager dashboard has no monetary summaries');
select public.test_denied($q$select public.owner_dashboard_metrics(current_date,current_date)$q$,'Manager cannot call Owner dashboard metrics');
select public.test_denied($q$select public.owner_financial_analytics(current_date,current_date,'day',true)$q$,'Manager cannot call financial analytics');
select public.test_denied($q$select public.owner_report_breakdowns(current_date,current_date)$q$,'Manager cannot read financial breakdowns');
select public.test_denied($q$select * from public.owner_sales_trend(current_date,current_date)$q$,'Manager cannot read revenue/profit trends');
select public.test_denied($q$select public.owner_expense_total(current_date,current_date)$q$,'Manager cannot read expense summaries');
select public.test_assert((select count(*)=0 from public.sale_item_costs),'Manager cannot read sold-cost allocations');
select public.test_assert((select count(*)=0 from public.return_allocations),'Manager cannot read return cost allocations');
select public.test_assert((select count(*)=0 from public.audit_logs),'Manager cannot read confidential audit payloads');
update public.user_roles set role='owner' where user_id=auth.uid();
select public.test_assert(public.current_role()='manager','Manager cannot promote themselves to Owner through direct API writes');

insert into public.suppliers(id,name,created_by) values('31000000-0000-4000-8000-000000000003','Manager operations supplier',auth.uid());
insert into public.test_ids values('manager-supplier','31000000-0000-4000-8000-000000000003');
insert into public.test_ids select 'manager-medicine',(public.save_guided_medicine(null,
 '{"name":"Manager operations medicine","dosage_form":"Tablet","barcode":"MANAGER-OPERATIONS","tablets_per_strip":10,"strips_per_box":2,"units":[{"unit_key":"base","selling_price":10},{"unit_key":"strip","selling_price":100},{"unit_key":"box","selling_price":200}]}',
 '{"unit_key":"box","quantity":2,"batch_number":"MANAGER-INITIAL","expiry_date":"2099-12-25","total_cost":40,"supplier_id":"31000000-0000-4000-8000-000000000003"}',
 '31000000-0000-4000-8000-000000000010')->>'id')::uuid;
select public.test_assert((select sum(quantity_on_hand)=40 from public.medicine_batches where medicine_id=(select id from public.test_ids where label='manager-medicine')),'Manager can create medicine and receive stock with original unit conversions');
insert into public.test_ids select 'manager-purchase',public.create_purchase(
 '{"supplier_id":"31000000-0000-4000-8000-000000000003"}',
 jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='manager-medicine'),'unit_key','box','quantity',1,'unit_cost',20,'batch_number','MANAGER-PURCHASE','expiry_date','2099-12-25')));
select public.post_purchase((select id from public.test_ids where label='manager-purchase'));
select public.test_assert((select sum(quantity_on_hand)=60 from public.medicine_batches where medicine_id=(select id from public.test_ids where label='manager-medicine')),'Manager can create and post a purchase without changing stock formulas');
insert into public.test_ids select 'manager-batch',id from public.medicine_batches where medicine_id=(select id from public.test_ids where label='manager-medicine') and batch_number='MANAGER-INITIAL';
select public.correct_stock((select id from public.test_ids where label='manager-batch'),39,40,'Manager physical stock count');
select public.dispose_stock('31000000-0000-4000-8000-000000000011',(select id from public.test_ids where label='manager-batch'),'discard',1,39,'Manager damaged tablet');
select public.dispose_stock('31000000-0000-4000-8000-000000000012',(select id from public.test_ids where label='manager-batch'),'supplier_return',1,38,'Manager supplier return','31000000-0000-4000-8000-000000000003');
select public.confirm_supplier_recovery('31000000-0000-4000-8000-000000000013','31000000-0000-4000-8000-000000000012','credit',1,'Manager supplier credit');
select public.test_assert((select quantity_on_hand=37 from public.medicine_batches where id=(select id from public.test_ids where label='manager-batch')),'Manager stock corrections, disposals and supplier returns deduct exact quantities');
insert into public.expense_categories(id,name) values('31000000-0000-4000-8000-000000000014','Manager operating expense');
insert into public.expenses(category_id,amount,expense_date,description,created_by) values('31000000-0000-4000-8000-000000000014',15,current_date,'Manager operational expense',auth.uid());
select public.test_assert((select count(*)=1 from public.expenses where category_id='31000000-0000-4000-8000-000000000014'),'Manager can record operating expenses');
select public.test_assert(not (public.supplier_operational_summary('31000000-0000-4000-8000-000000000003') ? 'total'),'Manager supplier summary omits purchase value');
select public.test_assert((public.supplier_operational_summary('31000000-0000-4000-8000-000000000003')->>'deliveries')::int=2,'Manager supplier operations count real deliveries');
do $$ begin
 if to_regprocedure('public.supplier_purchase_summary(uuid,boolean)') is not null then
  perform public.test_denied($q$select public.supplier_purchase_summary('31000000-0000-4000-8000-000000000003',true)$q$,'Manager cannot request supplier spend totals');
 end if;
end $$;

-- A different cashier owns this invoice; Manager can inspect and refund it.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
insert into public.test_ids select 'manager-other-sale',sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='manager-medicine'),'unit_key','base','quantity',2)),'cash',20,0,'31000000-0000-4000-8000-000000000015');
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
select public.test_assert((select count(*)=1 from public.sales where id=(select id from public.test_ids where label='manager-other-sale')),'Manager can read invoices created by another cashier');
select public.test_assert((select count(*)=1 from public.return_sales('',null,11,0,(select id from public.test_ids where label='manager-other-sale'))),'Manager return lookup includes another cashier invoice');
select public.complete_sale_return((select id from public.test_ids where label='manager-other-sale'),
 jsonb_build_array(jsonb_build_object('sale_item_id',(select id from public.sale_items where sale_id=(select id from public.test_ids where label='manager-other-sale')),'quantity',1,'restockable',true)),
 'Manager authorized return','31000000-0000-4000-8000-000000000016');
select public.test_assert((select refund_amount=10 from public.sale_returns where id='31000000-0000-4000-8000-000000000016'),'Manager refund uses original invoice amount');
insert into public.test_ids select 'manager-own-sale',sale_id from public.checkout_sale(jsonb_build_array(jsonb_build_object('medicine_id',(select id from public.test_ids where label='manager-medicine'),'unit_key','base','quantity',1)),'cash',10,0,'31000000-0000-4000-8000-000000000017');
select public.test_assert((select created_by=auth.uid() from public.sales where id=(select id from public.test_ids where label='manager-own-sale')),'Manager can complete a POS checkout under their own identity');
select public.test_assert((select count(*)=0 from public.sale_item_costs),'Manager cannot retrieve financial cost allocations even for their own sale');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.test_assert(not public.can_manage_operations(),'Salesperson operations permissions remain restricted');
select public.test_assert((select count(*)=0 from public.sales where id=(select id from public.test_ids where label='manager-own-sale')),'Salesperson cannot read Manager invoices');
select public.test_denied($q$select public.manager_dashboard()$q$,'Salesperson cannot access Manager dashboard');
select public.test_denied($q$select public.supplier_operational_summary('31000000-0000-4000-8000-000000000003')$q$,'Salesperson cannot access Manager supplier summary');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select public.test_assert(public.is_owner() and public.can_manage_operations(),'Owner retains financial and operational permissions');
select public.test_assert(public.owner_financial_analytics(current_date,current_date,'day',false) ? 'metrics','Owner financial reports remain available');

reset role;
update public.profiles set is_active=false where id='30000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
select public.test_assert(not public.is_active_staff() and not public.can_manage_operations(),'Inactive Manager loses staff and operational permissions');
select public.test_assert((select count(*)=0 from public.suppliers),'Inactive Manager cannot read operational supplier records');
select public.test_denied($q$select public.manager_dashboard()$q$,'Inactive Manager cannot access Manager dashboard');
select public.test_denied($q$select public.create_purchase('{}','[]')$q$,'Inactive Manager cannot mutate purchases');
rollback;
