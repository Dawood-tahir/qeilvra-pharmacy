-- Synthetic sizing fixtures in the disposable local database only. Counts below
-- are benchmark scenarios, never production assumptions or application limits.
create extension if not exists pg_freespacemap with schema extensions;
create table private.invoice_size_before (like public.sale_items including all);
create table private.invoice_size_after (like public.sale_items including all);
create table private.invoice_size_ledger (like private.invoice_item_ledger including all);
create table private.invoice_size_labels (like private.invoice_item_presentations including all);
insert into private.invoice_size_before(id,sale_id,medicine_id,medicine_name,medicine_sku,quantity,unit_price,line_total,
  created_at,selling_unit,net_line_total,unit_label,base_units_per_sale_unit,base_quantity,item_discount)
select md5('sizing-item-'||g)::uuid,md5('sizing-sale-'||g)::uuid,md5('sizing-med-'||(g%100))::uuid,
  'Medicine '||lpad((g%100)::text,3,'0')||' 500mg tablets','SKU-'||lpad((g%100)::text,5,'0'),1,7,7,
  now()-(g%365)*interval '1 day','base',7,'tablet',1,1,0 from generate_series(1,12000) g;
insert into private.invoice_size_after select * from private.invoice_size_before;
insert into private.invoice_size_labels(signature,medicine_name,medicine_sku,unit_label)
select distinct private.invoice_archive_sha256(jsonb_build_array(medicine_name,medicine_sku,unit_label)::text),medicine_name,medicine_sku,unit_label
from private.invoice_size_before where created_at<now()-interval '15 days';
insert into private.invoice_size_ledger(id,sale_id,medicine_id,quantity,unit_price,line_total,created_at,selling_unit,net_line_total,
  base_units_per_sale_unit,base_quantity,item_discount,presentation_id,archived)
select b.id,b.sale_id,b.medicine_id,
  case when old then b.quantity end,case when old then b.unit_price end,case when old then b.line_total end,
  case when old then b.created_at end,b.selling_unit,case when old then b.net_line_total end,
  case when old then b.base_units_per_sale_unit end,case when old then b.base_quantity end,case when old then b.item_discount end,
  case when old then p.id end,old
from private.invoice_size_before b cross join lateral(select b.created_at<now()-interval '15 days' old) age
left join private.invoice_size_labels p on p.medicine_name=b.medicine_name and p.medicine_sku=b.medicine_sku and p.unit_label=b.unit_label;
vacuum (analyze) private.invoice_size_before;
vacuum (analyze) private.invoice_size_after;
create table private.invoice_size_result as select
  pg_total_relation_size('private.invoice_size_before') original_allocated_bytes,
  (select coalesce(sum(avail),0) from extensions.pg_freespace('private.invoice_size_after')) original_free_heap_bytes;
delete from private.invoice_size_after where created_at<now()-interval '15 days';
vacuum (analyze) private.invoice_size_after;
vacuum (analyze) private.invoice_size_ledger;
vacuum (analyze) private.invoice_size_labels;
-- A separate compact equivalent measures live footprint; it is not a production
-- VACUUM FULL recommendation. Original pages above are left reusable in place.
create table private.invoice_size_compact_active (like public.sale_items including all);
insert into private.invoice_size_compact_active select * from private.invoice_size_after;
vacuum (analyze) private.invoice_size_compact_active;
alter table private.invoice_size_result add column metrics jsonb;
update private.invoice_size_result set metrics=jsonb_build_object(
  'synthetic_invoice_lines',12000,'distinct_medicine_labels',100,'history_days',365,'active_days',15,
  'retained_active_lines',(select count(*) from private.invoice_size_after),
  'deleted_original_lines',(select count(*) from private.invoice_size_ledger where archived),
  'original_allocated_bytes',original_allocated_bytes,
  'allocated_after_standard_vacuum_bytes',pg_total_relation_size('private.invoice_size_after')+pg_total_relation_size('private.invoice_size_ledger')+pg_total_relation_size('private.invoice_size_labels'),
  'compact_live_equivalent_bytes',pg_total_relation_size('private.invoice_size_compact_active')+pg_total_relation_size('private.invoice_size_ledger')+pg_total_relation_size('private.invoice_size_labels'),
  'new_reusable_heap_bytes',(select coalesce(sum(avail),0) from extensions.pg_freespace('private.invoice_size_after'))-original_free_heap_bytes,
  'unchanged_financial_inventory_tables_excluded',true);
select public.test_assert((select count(*) from private.invoice_size_after)+(select count(*) from private.invoice_size_ledger where archived)=12000,'size benchmark has no missing or duplicate logical lines');
select public.test_assert((select (metrics->>'new_reusable_heap_bytes')::bigint>0 from private.invoice_size_result),'standard vacuum makes deleted original heap space reusable');
