-- Disposable database only. Every test change is rolled back.
begin;
select public.test_assert((select not deletion_enabled from private.invoice_archive_settings),'ledger migration leaves deletion disabled');
select public.test_assert((select count(*) from public.invoice_item_rows)=(select count(*) from public.sale_items),'ledger migration does not duplicate active lines');
select public.test_assert((select count(*) from private.invoice_item_ledger)=(select count(*) from public.sale_items),'every pre-existing line has a stable foreign-key anchor');
select public.test_denied($q$insert into private.invoice_item_ledger(id,sale_id,medicine_id,selling_unit)
  select gen_random_uuid(),sale_id,medicine_id,selling_unit from public.sale_items where selling_unit is not null limit 1$q$,
  'original invoice/medicine/unit uniqueness also applies across retained history');
select public.test_assert(not has_table_privilege('authenticated','private.invoice_item_ledger','UPDATE'),'staff cannot change the retained ledger');
select public.test_assert(not has_table_privilege('authenticated','private.invoice_item_presentations','INSERT'),'staff cannot alter historical receipt labels');
select public.test_assert(not has_function_privilege('authenticated','public.invoice_archive_prune(uuid,bigint,bigint,text,uuid,integer)','EXECUTE'),'staff cannot call pruning');
select public.test_assert(not has_function_privilege('anon','public.sale_items(public.sales)','EXECUTE'),'anonymous callers cannot read archived receipts');
select public.test_assert((select count(*)>5 from private.invoice_ledger_function_migrations),'report, return and archive source functions are migrated');
select public.test_assert(not exists(select 1 from private.invoice_ledger_function_migrations
  where replace(installed_definition,'public.invoice_item_rows','public.sale_items') is distinct from previous_definition
    and signature not like 'private.apply_sale_return(%'),'function changes are limited to read sources and redundant return line locking');

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.test_assert(not exists(select 1 from public.invoice_item_rows i join public.sales s on s.id=i.sale_id where s.created_by<>auth.uid()),'line view preserves cashier scope');
select public.test_denied($q$select * from private.invoice_archive_prunes$q$,'staff cannot inspect prune metadata');
select public.test_denied($q$delete from public.sale_items$q$,'direct invoice detail deletion remains forbidden');
reset role;
rollback;
