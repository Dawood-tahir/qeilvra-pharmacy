-- Local disposable PostgreSQL only. Every fixture/configuration change rolls back.
begin;
reset role;
create temporary table archive_protocol_state(label text primary key,value jsonb);
grant all on archive_protocol_state to authenticated,service_role;
select public.test_assert((select not enabled and not deletion_enabled and generation=0 from private.invoice_archive_settings),'archiving and deletion are disabled on installation');
select public.test_assert((select not public from storage.buckets where id='invoice-archives'),'archive storage bucket is private');
select public.test_assert((select file_size_limit=33554432 from storage.buckets where id='invoice-archives'),'archive upload size is capped at the worker limit');
-- A pre-existing permissive policy must not expose the archive bucket.
insert into storage.buckets(id,name) values ('archive-test-other','archive-test-other');
insert into storage.objects(bucket_id,name) values ('invoice-archives','private.xlsx'),('archive-test-other','public-example');
grant usage on schema storage to anon,authenticated;
grant select on storage.objects to anon,authenticated;
create policy archive_test_existing_policy on storage.objects for select to anon,authenticated using (true);
set local role authenticated;
select public.test_assert((select count(*)=1 from storage.objects where bucket_id='archive-test-other'),'existing non-archive storage permissions remain intact');
select public.test_assert((select count(*)=0 from storage.objects where bucket_id='invoice-archives'),'restrictive storage policy blocks authenticated archive object access');
set local role anon;
select public.test_assert((select count(*)=0 from storage.objects where bucket_id='invoice-archives'),'restrictive storage policy blocks anonymous archive object access');
reset role;
select public.test_assert((select count(*)=4 and bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('invoice_archive_settings','invoice_archive_runs','invoice_archive_versions','invoice_archive_manifest')),'every archive metadata table has RLS');
select public.test_assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'invoice_archive_%' and has_function_privilege('anon',p.oid,'EXECUTE')),'anonymous callers have no archive function grants');
select public.test_assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'invoice_archive_%' and has_function_privilege('authenticated',p.oid,'EXECUTE')),'authenticated callers have no archive function grants');
select public.test_denied($q$update private.invoice_archive_settings set deletion_enabled=true$q$,'canonical deletion cannot be activated');

-- Exact local invoice fixtures. Financial equivalence uses real checkout fixtures separately.
insert into public.sales(id,invoice_number,idempotency_key,subtotal,net_total,created_by,completed_at) values
 ('a1600000-0000-4000-8000-000000000001','ARCHIVE-PROTOCOL-OLD',gen_random_uuid(),7,7,'10000000-0000-0000-0000-000000000001',clock_timestamp()-interval '16 days'),
 ('a1600000-0000-4000-8000-000000000002','ARCHIVE-PROTOCOL-YOUNG',gen_random_uuid(),7,7,'10000000-0000-0000-0000-000000000001',clock_timestamp()-interval '14 days'),
 ('a1600000-0000-4000-8000-000000000003','ARCHIVE-PROTOCOL-PENDING',gen_random_uuid(),7,7,'10000000-0000-0000-0000-000000000001',clock_timestamp()-interval '17 days'),
 ('a1600000-0000-4000-8000-000000000004','ARCHIVE-PROTOCOL-PARTIAL',gen_random_uuid(),7,7,'10000000-0000-0000-0000-000000000001',clock_timestamp()-interval '14 days');
update public.sales set status='partially_refunded' where invoice_number='ARCHIVE-PROTOCOL-PARTIAL';
insert into public.sale_items(sale_id,medicine_id,medicine_name,medicine_sku,quantity,unit_price,line_total,selling_unit,unit_label,base_units_per_sale_unit,base_quantity,net_line_total)
 select s.id,m.id,m.name,m.sku,1,7,7,'base','tablet',1,1,7 from public.sales s cross join public.medicines m
 where s.invoice_number like 'ARCHIVE-PROTOCOL-%' and m.id=(select id from public.test_ids where label='medicine');
insert into public.payments(sale_id,kind,method,amount,tendered_amount,received_by)
 select id,'sale','cash',7,7,created_by from public.sales where invoice_number like 'ARCHIVE-PROTOCOL-%';
insert into public.sale_item_costs(sale_item_id,batch_id,quantity,unit_cost)
 select i.id,b.id,1,b.purchase_cost from public.sale_items i
 cross join lateral(select id,purchase_cost from public.medicine_batches where medicine_id=i.medicine_id order by id limit 1)b
 where i.sale_id in (select id from public.sales where invoice_number like 'ARCHIVE-PROTOCOL-%');
insert into public.sale_returns(id,return_number,sale_id,reason,requested_by) values
 ('a1600000-0000-4000-8000-000000000099','ARCHIVE-PROTOCOL-PENDING-RETURN','a1600000-0000-4000-8000-000000000003','Pending local fixture return','10000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.test_denied($q$select public.invoice_archive_claim(true)$q$,'forged JWT role cannot invoke archive worker');
select public.test_denied($q$select * from private.invoice_archive_versions$q$,'owner and salesperson cannot directly read archive metadata');
select public.test_denied($q$update private.invoice_archive_settings set enabled=true$q$,'authenticated owner cannot activate the worker through direct writes');
set local role anon;
select public.test_denied($q$select public.invoice_archive_current()$q$,'anonymous archive downloads are denied');

set local role service_role;
select public.test_assert(public.invoice_archive_claim()->>'status'='disabled','scheduled work is a no-op before activation');
select public.test_assert(public.invoice_archive_current() is null,'no workbook is published before a verified commit');
select public.test_denied($q$select * from private.invoice_archive_settings$q$,'worker has RPC-only access to metadata');
insert into archive_protocol_state values('dry_claim',public.invoice_archive_claim(true));
insert into archive_protocol_state select 'dry_batch',public.invoice_archive_batch((value->>'lease')::uuid,(value->>'fence')::bigint,25) from archive_protocol_state where label='dry_claim';
select public.test_assert((select value->>'status'='ready' and jsonb_array_length(value->'candidates')=1 from archive_protocol_state where label='dry_batch'),'dry run exports only completed old sales without pending returns');
do $$ declare c jsonb; b jsonb; begin
 select value into c from archive_protocol_state where label='dry_claim'; select value into b from archive_protocol_state where label='dry_batch';
 begin
  perform public.invoice_archive_commit((c->>'lease')::uuid,(c->>'fence')::bigint,0,'versions/1/'||(c->>'lease')||'-'||repeat('a',64)||'.xlsx',repeat('a',64),100,
    (select jsonb_agg(jsonb_build_object('sale_id',x->>'sale_id','source_sha256',x->>'source_sha256')) from jsonb_array_elements(b->'candidates')x));
  raise exception 'Dry run publication must be denied';
 exception when raise_exception then if sqlerrm='Dry run publication must be denied' then raise; end if; end;
 perform public.test_assert(public.invoice_archive_release((c->>'lease')::uuid,(c->>'fence')::bigint)->>'status'='dry_run','dry run releases without publishing');
end $$;

reset role;
update private.invoice_archive_settings set enabled=true;
set local role service_role;
insert into archive_protocol_state values('claim',public.invoice_archive_claim());
select public.test_assert(public.invoice_archive_claim()->>'status'='busy','a second worker cannot claim an active lease');
reset role;
update public.sales set completed_at=(select (value->>'cutoff')::timestamptz from archive_protocol_state where label='claim') where invoice_number='ARCHIVE-PROTOCOL-YOUNG';
set local role service_role;
do $$ declare c jsonb; begin
 select value into c from archive_protocol_state where label='claim';
 perform public.test_denied(format('select public.invoice_archive_batch(%L::uuid,%s,0)',c->>'lease',c->>'fence'),'zero batch limit rejected');
 perform public.test_denied(format('select public.invoice_archive_batch(%L::uuid,%s,101)',c->>'lease',c->>'fence'),'oversized batch rejected');
 perform public.test_assert(public.invoice_archive_heartbeat((c->>'lease')::uuid,(c->>'fence')::bigint)->>'status'='renewed','a live worker renews its lease');
end $$;
insert into archive_protocol_state select 'batch',public.invoice_archive_batch((value->>'lease')::uuid,(value->>'fence')::bigint,1) from archive_protocol_state where label='claim';
do $$ declare c jsonb; b jsonb; p jsonb; m jsonb; key text; v jsonb; begin
 select value into c from archive_protocol_state where label='claim'; select value into b from archive_protocol_state where label='batch';
 perform public.test_assert(b->'candidates'=public.invoice_archive_batch((c->>'lease')::uuid,(c->>'fence')::bigint,100)->'candidates','retry returns the identical fixed batch despite a different limit');
 select x into p from jsonb_array_elements(b->'candidates')x limit 1;
 perform public.test_assert(p->>'sale_id'='a1600000-0000-4000-8000-000000000001','recent refunded and unresolved invoices are excluded');
 perform public.test_assert(jsonb_array_length(b->'candidates')=1,'sale exactly at the fixed fifteen-day cutoff is excluded');
 perform public.test_assert(encode(sha256(convert_to(p->>'payload_text','UTF8')),'hex')=p->>'source_sha256','source hash covers the exact PostgreSQL JSON text');
 perform public.test_assert((p->>'payload_text')::jsonb ?& array['sale','items','payments','costs','returns','return_items','return_allocations','stock_movements','audit_events','cashier'],'archive source includes all recoverable transaction sections');
 perform public.test_assert((((p->>'payload_text')::jsonb->'cashier')-array['id','full_name'])='{}'::jsonb,'cashier snapshot excludes auth data and mutable last-seen settings');
 m:=jsonb_build_array(jsonb_build_object('sale_id',p->>'sale_id','source_sha256',p->>'source_sha256'));
 key:='versions/1/'||(c->>'lease')||'-'||repeat('a',64)||'.xlsx';
 perform public.test_denied(format('select public.invoice_archive_commit(%L::uuid,%s,0,%L,%L,100,%L::jsonb)',c->>'lease',c->>'fence',key,repeat('a',64),'[]'),'empty manifest cannot publish');
 perform public.test_denied(format('select public.invoice_archive_commit(%L::uuid,%s,0,%L,%L,100,%L::jsonb)',c->>'lease',c->>'fence','latest.xlsx',repeat('a',64),m::text),'mutable latest object key cannot publish');
 perform public.test_denied(format('select public.invoice_archive_commit(%L::uuid,%s,0,%L,%L,100,%L::jsonb)',c->>'lease',c->>'fence',key,repeat('a',64),(m||m)::text),'duplicate manifest IDs cannot publish');
 v:=public.invoice_archive_commit((c->>'lease')::uuid,(c->>'fence')::bigint,0,key,repeat('a',64),100,m);
 perform public.test_assert(v->>'status'='committed' and (v->>'deleted_count')::int=0 and (v->>'canonical_unchanged')::boolean,'verified generation publishes with zero ledger deletions');
 perform public.test_assert((v->'current_version'->>'invoice_count')::int=1 and (v->'current_version'->>'generation')::int=1,'published version reports exact manifest count and generation');
 perform public.test_assert((public.invoice_archive_current()->>'object_key')=key,'download pointer advances only to committed immutable version');
 perform public.test_assert((public.invoice_archive_commit((c->>'lease')::uuid,(c->>'fence')::bigint,0,key,repeat('a',64),100,m)->>'replayed')::boolean,'lost-response retry returns the original committed generation');
 perform public.test_denied(format('select public.invoice_archive_commit(%L::uuid,%s,0,%L,%L,100,%L::jsonb)',c->>'lease',c->>'fence','versions/1/'||(c->>'lease')||'-'||repeat('b',64)||'.xlsx',repeat('b',64),m::text),'same generation cannot be replaced by different bytes');
 perform public.test_assert(public.invoice_archive_batch((c->>'lease')::uuid,(c->>'fence')::bigint)->>'status'='empty','unchanged archived sales are skipped');
end $$;
reset role;
select public.test_assert((select canonical_before=canonical_after and deleted_count=0 from private.invoice_archive_versions where generation=1),'stored canonical fingerprints reconcile across publication');
select public.test_assert((select canonical_before=jsonb_build_object('a1600000-0000-4000-8000-000000000001',jsonb_build_object(
 'source_sha256',(select value->'candidates'->0->>'source_sha256' from archive_protocol_state where label='batch'),'pending_return',false))
 from private.invoice_archive_versions where generation=1),'publication evidence includes only the fixed batch source and pending-return eligibility');
-- The exact-cutoff probe would become eligible a few microseconds into the next
-- lease. Return it to a recent age until the later append test deliberately ages it.
update public.sales set completed_at=clock_timestamp()-interval '14 days' where invoice_number='ARCHIVE-PROTOCOL-YOUNG';
update public.sales set customer_name='Changed after archive' where id='a1600000-0000-4000-8000-000000000001';
set local role service_role;
update archive_protocol_state set value=public.invoice_archive_batch((value->>'lease')::uuid,(value->>'fence')::bigint) where label='claim';
insert into archive_protocol_state select 'dirty_batch',value from archive_protocol_state where label='claim';
reset role;
update public.sales set customer_name='Changed again during upload' where id='a1600000-0000-4000-8000-000000000001';
set local role service_role;
do $$ declare b jsonb; m jsonb; begin
 select value into b from archive_protocol_state where label='dirty_batch';
 select jsonb_agg(jsonb_build_object('sale_id',x->>'sale_id','source_sha256',x->>'source_sha256')) into m from jsonb_array_elements(b->'candidates')x;
 perform public.test_denied(format('select public.invoice_archive_commit(%L::uuid,%s,1,%L,%L,100,%L::jsonb)',b->>'lease',b->>'fence','versions/2/'||(b->>'lease')||'-'||repeat('b',64)||'.xlsx',repeat('b',64),m::text),'source mutation after export rejects publication');
 perform public.test_assert((public.invoice_archive_current()->>'generation')::int=1,'source mismatch preserves the previous recoverable workbook');
 perform public.invoice_archive_release((b->>'lease')::uuid,(b->>'fence')::bigint,'Expected source mismatch');
end $$;
insert into archive_protocol_state values('next_claim',public.invoice_archive_claim());
insert into archive_protocol_state select 'next_batch',public.invoice_archive_batch((value->>'lease')::uuid,(value->>'fence')::bigint) from archive_protocol_state where label='next_claim';
do $$ declare c jsonb; b jsonb; m jsonb; v jsonb; begin
 select value into c from archive_protocol_state where label='next_claim'; select value into b from archive_protocol_state where label='next_batch';
 select jsonb_agg(jsonb_build_object('sale_id',x->>'sale_id','source_sha256',x->>'source_sha256')) into m from jsonb_array_elements(b->'candidates')x;
 v:=public.invoice_archive_commit((c->>'lease')::uuid,(c->>'fence')::bigint,1,'versions/2/'||(c->>'lease')||'-'||repeat('b',64)||'.xlsx',repeat('b',64),101,m);
 perform public.test_assert(v->'current_version'->>'previous_object_key' like 'versions/1/%','previous immutable workbook remains recoverable');
 perform public.invoice_archive_release((c->>'lease')::uuid,(c->>'fence')::bigint);
end $$;

-- A later batch cannot replace the accumulating workbook with only its new rows.
reset role;
update public.sales set completed_at=clock_timestamp()-interval '16 days' where invoice_number='ARCHIVE-PROTOCOL-YOUNG';
set local role service_role;
insert into archive_protocol_state values('append_claim',public.invoice_archive_claim());
insert into archive_protocol_state select 'append_batch',public.invoice_archive_batch((value->>'lease')::uuid,(value->>'fence')::bigint) from archive_protocol_state where label='append_claim';
do $$ declare c jsonb; b jsonb; m jsonb; old_m jsonb; v jsonb; begin
 select value into c from archive_protocol_state where label='append_claim'; select value into b from archive_protocol_state where label='append_batch';
 select jsonb_agg(jsonb_build_object('sale_id',x->>'sale_id','source_sha256',x->>'source_sha256')) into m from jsonb_array_elements(b->'candidates')x;
 perform public.test_assert(jsonb_array_length(m)=1 and m->0->>'sale_id'='a1600000-0000-4000-8000-000000000002','next batch contains only the newly aged invoice');
 perform public.test_denied(format('select public.invoice_archive_commit(%L::uuid,%s,2,%L,%L,100,%L::jsonb)',c->>'lease',c->>'fence','versions/3/'||(c->>'lease')||'-'||repeat('c',64)||'.xlsx',repeat('c',64),m::text),'new batch cannot drop invoices already in the workbook');
 select jsonb_agg(jsonb_build_object('sale_id',x->>'sale_id','source_sha256',x->>'source_sha256')) into old_m from jsonb_array_elements((select value->'candidates' from archive_protocol_state where label='next_batch'))x;
 v:=public.invoice_archive_commit((c->>'lease')::uuid,(c->>'fence')::bigint,2,'versions/3/'||(c->>'lease')||'-'||repeat('c',64)||'.xlsx',repeat('c',64),101,old_m||m);
 perform public.test_assert((v->'current_version'->>'invoice_count')::int=2,'full manifest preserves old invoices while appending the new batch');
 perform public.invoice_archive_release((c->>'lease')::uuid,(c->>'fence')::bigint);
end $$;

-- A stale worker cannot write after lease expiry and a newer fence.
insert into archive_protocol_state values('expiring',public.invoice_archive_claim());
reset role;
update private.invoice_archive_runs set expires_at=clock_timestamp()-interval '1 second' where lease=(select (value->>'lease')::uuid from archive_protocol_state where label='expiring');
set local role service_role;
do $$ declare c jsonb; begin
 select value into c from archive_protocol_state where label='expiring';
 perform public.test_denied(format('select public.invoice_archive_heartbeat(%L::uuid,%s)',c->>'lease',c->>'fence'),'expired worker cannot renew a dead lease');
end $$;
insert into archive_protocol_state values('replacement',public.invoice_archive_claim());
do $$ declare c jsonb; n jsonb; begin
 select value into c from archive_protocol_state where label='expiring'; select value into n from archive_protocol_state where label='replacement';
 perform public.test_assert((n->>'fence')::bigint>(c->>'fence')::bigint,'replacement run receives a strictly newer fence');
 perform public.test_denied(format('select public.invoice_archive_batch(%L::uuid,%s)',c->>'lease',c->>'fence'),'stale fence cannot export a newer run');
 perform public.test_denied(format('select public.invoice_archive_release(%L::uuid,%s)',c->>'lease',c->>'fence'),'stale fence cannot release the new worker');
 perform public.invoice_archive_release((n->>'lease')::uuid,(n->>'fence')::bigint);
end $$;
reset role;
select public.test_assert((select count(*)=4 from public.sales where invoice_number like 'ARCHIVE-PROTOCOL-%'),'all canonical invoice fixtures remain present');
select public.test_assert((select count(*)=3 from private.invoice_archive_versions),'only successful immutable generations were published');
rollback;
