begin isolation level repeatable read read only;
select jsonb_build_object(
 'database_version',current_setting('server_version'),
 'medicines',(select count(*) from public.medicines),
 'batch_receipts',(select count(*) from public.medicine_batches),
 'fractional_batch_balances',(select count(*) from public.medicine_batches where quantity_on_hand<>trunc(quantity_on_hand)),
 'sales',(select count(*) from public.sales),
 'purchases',(select count(*) from public.purchases),
 'owners',(select count(*) from public.user_roles where role='owner'),
 'salespeople',(select count(*) from public.user_roles where role='salesperson'),
 'duplicate_medicine_groups',(select count(*) from (select 1 from public.medicines group by lower(trim(name)),lower(trim(coalesce(strength,''))),lower(trim(coalesce(dosage_form,''))),lower(trim(coalesce(manufacturer,''))) having count(*)>1) d)
) as rollout_preflight;
select jsonb_object_agg(name,fingerprint) as history_fingerprints from (
 select 'medicines' name,md5(coalesce(string_agg((to_jsonb(t)-array['packaging_status','tablets_per_strip','strips_per_box'])::text,'|' order by id),'')) fingerprint from public.medicines t
 union all select 'batches',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.medicine_batches t
 union all select 'sales',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.sales t
 union all select 'sale_items',md5(coalesce(string_agg((to_jsonb(t)-array['selling_unit','unit_label','base_units_per_sale_unit','base_quantity','net_line_total'])::text,'|' order by id),'')) from public.sale_items t
 union all select 'sale_costs',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.sale_item_costs t
 union all select 'purchases',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.purchases t
 union all select 'purchase_items',md5(coalesce(string_agg((to_jsonb(t)-array['received_unit','received_quantity','base_units_per_received_unit'])::text,'|' order by id),'')) from public.purchase_items t
 union all select 'payments',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.payments t
 union all select 'returns',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.sale_returns t
 union all select 'return_items',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.return_items t
 union all select 'stock_movements',md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.stock_movements t
) f;
rollback;
