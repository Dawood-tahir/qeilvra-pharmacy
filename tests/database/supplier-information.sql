-- Disposable PostgreSQL fixtures only; every record and edit below rolls back.
begin;
reset role;
insert into auth.users(id,email) values('31000000-0000-4000-8000-000000000003','supplier-manager@example.test');
insert into public.profiles(id,full_name) values('31000000-0000-4000-8000-000000000003','Supplier Manager');
insert into public.user_roles(user_id,role) values('31000000-0000-4000-8000-000000000003','manager');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
insert into public.suppliers(id,name,contact_person,phone,tax_number,created_by) values
 ('52000000-0000-4000-8000-000000000005','Editable supplier','0300 / legacy contact',null,'NTN-001 / A','10000000-0000-0000-0000-000000000001'),
 ('52000000-0000-4000-8000-000000000006','Unrelated supplier','Other contact','03001112222','Other NTN','10000000-0000-0000-0000-000000000001');
select public.receive_stock((select id from public.test_ids where label='medicine'),jsonb_build_object(
 'supplier_id','52000000-0000-4000-8000-000000000005','unit_key','box','quantity',1,
 'batch_number','EDIT-SUPPLIER','expiry_date',current_date+365,'total_cost',100),gen_random_uuid());
create temp table supplier_summary_before as select
 (select coalesce(sum(total),0) from public.purchases where supplier_id='52000000-0000-4000-8000-000000000005' and status='posted') financial,
 public.supplier_operational_summary('52000000-0000-4000-8000-000000000005') operational;
reset role;
create function pg_temp.supplier_related_snapshot() returns jsonb language plpgsql as $$
declare relation record; fingerprint text; result jsonb:='{}';
begin
 for relation in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind='r' and c.relname<>'suppliers' order by n.nspname,c.relname loop
  execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by to_jsonb(t)::text),'''')) from %I.%I t',relation.nspname,relation.relname) into fingerprint;
  result:=result||jsonb_build_object(relation.nspname||'.'||relation.relname,fingerprint);
 end loop;
 return result;
end $$;
create temp table supplier_edit_before as select
 pg_temp.supplier_related_snapshot() related,
 (select count(*) from public.suppliers) supplier_count,
 (select to_jsonb(s)-'updated_at' from public.suppliers s where id='52000000-0000-4000-8000-000000000006') other_supplier,
 (select to_jsonb(s)-array['name','contact_person','phone','email','address','city','tax_number','updated_at'] from public.suppliers s where id='52000000-0000-4000-8000-000000000005') identity;
select public.test_assert((select city is null and phone is null and contact_person='0300 / legacy contact' from public.suppliers where id='52000000-0000-4000-8000-000000000005'),'additive city field preserves missing phones and ambiguous historical contact values');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
update public.suppliers set name='City Pharmacy / Distributor',contact_person='Dr. Ahmed',phone='+92 300 1234567',email='orders@example.com',address=E'12 Main Road\nFloor 2',city='Lahore',tax_number='NTN-001 / A'
 where id='52000000-0000-4000-8000-000000000005';
select public.test_assert((select name='City Pharmacy / Distributor' and contact_person='Dr. Ahmed' and phone='+92 300 1234567' and email='orders@example.com' and address=E'12 Main Road\nFloor 2' and city='Lahore' and tax_number='NTN-001 / A' from public.suppliers where id='52000000-0000-4000-8000-000000000005'),'Owner updates all seven supplier fields on the existing record');
select public.test_assert((select
 (select coalesce(sum(total),0) from public.purchases where supplier_id='52000000-0000-4000-8000-000000000005' and status='posted')=financial and
 public.supplier_operational_summary('52000000-0000-4000-8000-000000000005')=operational
 from supplier_summary_before),'supplier totals, medicine counts, deliveries and last purchase dates remain unchanged');
select set_config('request.jwt.claim.sub','31000000-0000-4000-8000-000000000003',true);
with edited as (update public.suppliers set city='Karachi' where id='52000000-0000-4000-8000-000000000005' returning id)
select public.test_assert((select count(*)=1 from edited),'authorized Manager can edit supplier information');
reset role;
select public.test_assert((select pg_temp.supplier_related_snapshot()=related from supplier_edit_before),'editing supplier information leaves every purchase, medicine, batch, stock movement, return and financial table unchanged');
select public.test_assert((select (select count(*) from public.suppliers)=supplier_count and (select to_jsonb(s)-'updated_at' from public.suppliers s where id='52000000-0000-4000-8000-000000000006')=other_supplier and (select to_jsonb(s)-array['name','contact_person','phone','email','address','city','tax_number','updated_at'] from public.suppliers s where id='52000000-0000-4000-8000-000000000005')=identity from supplier_edit_before),'supplier ID, activation, creator, creation date, count and unrelated supplier remain unchanged');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
with edited as (update public.suppliers set name='Unauthorized edit' where id='52000000-0000-4000-8000-000000000005' returning id)
select public.test_assert((select count(*)=0 from edited),'Salesperson cannot edit suppliers through a direct database request');
reset role;
update public.profiles set is_active=false where id='31000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','31000000-0000-4000-8000-000000000003',true);
with edited as (update public.suppliers set name='Inactive edit' where id='52000000-0000-4000-8000-000000000005' returning id)
select public.test_assert((select count(*)=0 from edited),'inactive Manager cannot edit suppliers');
set local role anon;
select public.test_denied($q$update public.suppliers set city='Unauthorized' where id='52000000-0000-4000-8000-000000000005'$q$,'anonymous users cannot edit suppliers');
reset role;
select public.test_assert((select name='City Pharmacy / Distributor' and city='Karachi' from public.suppliers where id='52000000-0000-4000-8000-000000000005'),'unauthorized requests preserve the saved supplier values');
rollback;
