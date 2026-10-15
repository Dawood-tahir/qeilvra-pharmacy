begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner@test.local', extensions.crypt('OwnerPass123!', extensions.gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'sales@test.local', extensions.crypt('SalesPass123!', extensions.gen_salt('bf')), now(), now(), now());

insert into public.profiles (id, full_name) values
  ('10000000-0000-0000-0000-000000000001', 'Test Owner'),
  ('20000000-0000-0000-0000-000000000002', 'Test Salesperson');
insert into public.user_roles (user_id, role) values
  ('10000000-0000-0000-0000-000000000001', 'owner'),
  ('20000000-0000-0000-0000-000000000002', 'salesperson');
insert into public.medicine_categories (id, name) values ('30000000-0000-0000-0000-000000000003', 'Test category');
insert into public.medicines (id, name, category_id, sku, selling_price, reorder_level, base_unit, created_by) values
  ('40000000-0000-0000-0000-000000000004', 'Valid Medicine', '30000000-0000-0000-0000-000000000003', 'VALID-1', 100, 2, 'tablet', '10000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000005', 'Expired Medicine', '30000000-0000-0000-0000-000000000003', 'EXPIRED-1', 50, 2, 'tablet', '10000000-0000-0000-0000-000000000001');
insert into public.medicine_costs (medicine_id, default_purchase_cost, updated_by) values
  ('40000000-0000-0000-0000-000000000004', 60, '10000000-0000-0000-0000-000000000001');
insert into public.medicine_batches (id, medicine_id, batch_number, expiry_date, quantity_on_hand, purchase_cost) values
  ('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000004', 'GOOD', current_date + 365, 3, 60),
  ('50000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000005', 'OLD', current_date - 1, 2, 25);

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select is(public.current_role()::text, 'salesperson', 'salesperson role resolves from a fresh auth identity');
select is((select count(*) from public.medicine_costs), 0::bigint, 'salesperson cannot read medicine purchase costs');
select is((select count(*) from public.medicine_batches), 0::bigint, 'salesperson cannot read cost-bearing batch rows');
select is((select count(*) from public.medicines), 2::bigint, 'salesperson can read the sales-safe catalogue');

update public.medicines set selling_price = 1 where id = '40000000-0000-0000-0000-000000000004';
select is((select selling_price from public.medicines where id = '40000000-0000-0000-0000-000000000004'), 100.00::numeric, 'salesperson cannot change a selling price');
update public.user_roles set role = 'owner' where user_id = '20000000-0000-0000-0000-000000000002';
select is(public.current_role()::text, 'salesperson', 'salesperson cannot elevate their role');

select lives_ok($$select * from public.checkout_sale(
  '[{"medicine_id":"40000000-0000-0000-0000-000000000004","quantity":3}]'::jsonb,
  'cash', 300, 0, '60000000-0000-0000-0000-000000000006', null, null
)$$, 'valid POS checkout succeeds');
select is((select count(*) from public.sales), 1::bigint, 'checkout creates one sale visible to its salesperson');
select lives_ok($$select * from public.checkout_sale(
  '[{"medicine_id":"40000000-0000-0000-0000-000000000004","quantity":3}]'::jsonb,
  'cash', 300, 0, '60000000-0000-0000-0000-000000000006', null, null
)$$, 'duplicate idempotency key returns the original sale');
select is((select count(*) from public.sales), 1::bigint, 'duplicate checkout does not create a second sale');
select throws_ok($$select * from public.checkout_sale(
  '[{"medicine_id":"40000000-0000-0000-0000-000000000004","quantity":1}]'::jsonb,
  'cash', 100, 0, '60000000-0000-0000-0000-000000000007', null, null
)$$, 'P0001', null, 'insufficient stock is rejected');
select throws_ok($$select * from public.checkout_sale(
  '[{"medicine_id":"40000000-0000-0000-0000-000000000005","quantity":1}]'::jsonb,
  'cash', 50, 0, '60000000-0000-0000-0000-000000000008', null, null
)$$, 'P0001', 'This batch has expired and cannot be sold.', 'expired medicine sale is rejected');
select is((select available_quantity from public.search_sellable_medicines('VALID-1', 10, 0)), 0::numeric, 'successful checkout deducts inventory');
select throws_ok($$select public.review_sale_return('70000000-0000-0000-0000-000000000007', true, '[]'::jsonb, null, 'cash')$$, '42501', 'Owner permission required', 'salesperson cannot authorize refunds');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is(public.current_role()::text, 'owner', 'owner role resolves correctly');
select is((select count(*) from public.medicine_costs), 1::bigint, 'owner can read purchase cost data');
select lives_ok($$select public.owner_dashboard_metrics(current_date, current_date)$$, 'owner financial report is available');

select * from finish();
rollback;
