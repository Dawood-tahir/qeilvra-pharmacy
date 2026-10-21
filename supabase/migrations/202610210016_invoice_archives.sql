-- Review and approve before hosted activation. No canonical transaction is deleted.
-- The workbook is a private, versioned backup; the operational ledger stays intact.
begin;

-- Source snapshots look up sale/refund movements by their immutable references.
create index if not exists stock_movements_reference_idx
  on public.stock_movements(reference_type,reference_id,id);

create table private.invoice_archive_settings (
  singleton_id boolean primary key default true check (singleton_id),
  enabled boolean not null default false,
  deletion_enabled boolean not null default false check (deletion_enabled = false),
  generation bigint not null default 0 check (generation >= 0),
  fence bigint not null default 0 check (fence >= 0),
  current_version_id uuid,
  updated_at timestamptz not null default clock_timestamp()
);
insert into private.invoice_archive_settings(singleton_id) values (true);

create table private.invoice_archive_runs (
  lease uuid primary key default gen_random_uuid(),
  fence bigint not null unique,
  expected_generation bigint not null,
  cutoff timestamptz not null,
  dry_run boolean not null,
  state text not null default 'running' check (state in ('running','released','failed','expired','dry_run')),
  started_at timestamptz not null default clock_timestamp(),
  last_heartbeat timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '5 minutes'),
  finished_at timestamptz,
  batch_candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(batch_candidates)='array'),
  last_error text,
  committed_versions integer not null default 0
);
create unique index invoice_archive_one_live_run on private.invoice_archive_runs ((true)) where state='running';

create table private.invoice_archive_versions (
  id uuid primary key default gen_random_uuid(),
  generation bigint not null unique check (generation > 0),
  lease uuid not null references private.invoice_archive_runs(lease),
  fence bigint not null,
  object_key text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  invoice_count bigint not null check (invoice_count > 0),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  previous_version_id uuid references private.invoice_archive_versions(id),
  -- These attest only the fixed batch's source hashes, not whole-table totals.
  -- Reconciliation tests independently verify the unchanged canonical ledger.
  canonical_before jsonb not null,
  canonical_after jsonb not null,
  deleted_count bigint not null default 0 check (deleted_count=0),
  retained_reason text not null default 'Canonical financial, inventory and return ledger retained',
  created_at timestamptz not null default clock_timestamp(),
  check (canonical_before = canonical_after)
);
alter table private.invoice_archive_settings add constraint invoice_archive_current_version_fkey
  foreign key (current_version_id) references private.invoice_archive_versions(id);

create table private.invoice_archive_manifest (
  sale_id uuid primary key references public.sales(id),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  first_generation bigint not null,
  generation bigint not null references private.invoice_archive_versions(generation),
  archived_at timestamptz not null default clock_timestamp()
);
alter table private.invoice_archive_settings enable row level security;
alter table private.invoice_archive_runs enable row level security;
alter table private.invoice_archive_versions enable row level security;
alter table private.invoice_archive_manifest enable row level security;
revoke all on private.invoice_archive_settings,private.invoice_archive_runs,private.invoice_archive_versions,private.invoice_archive_manifest
  from public,anon,authenticated,service_role;

-- A real database role is required. User-controlled JWT claim settings do not grant access.
create function private.invoice_archive_assert_service() returns void language plpgsql set search_path='' as $$
begin
  if current_setting('role',true) is distinct from 'service_role' and session_user <> 'service_role' then
    raise exception 'Archive worker service role required' using errcode='42501';
  end if;
end $$;

-- Full original transaction rows, without auth.users or mutable batch balances.
-- SQL jsonb::text is the hash source; clients must not reserialize it before hashing.
create function private.invoice_archive_payload(p_sale_id uuid) returns text
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'sale',to_jsonb(s),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.sale_items i where i.sale_id=s.id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.payments p where p.sale_id=s.id),'[]'::jsonb),
    'costs',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.sale_item_costs c join public.sale_items i on i.id=c.sale_item_id where i.sale_id=s.id),'[]'::jsonb),
    'returns',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.sale_returns r where r.sale_id=s.id),'[]'::jsonb),
    'return_items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.return_items i join public.sale_returns r on r.id=i.return_id where r.sale_id=s.id),'[]'::jsonb),
    'return_allocations',coalesce((select jsonb_agg(to_jsonb(a) order by a.return_item_id,a.sale_item_cost_id) from public.return_allocations a join public.return_items i on i.id=a.return_item_id join public.sale_returns r on r.id=i.return_id where r.sale_id=s.id),'[]'::jsonb),
    'stock_movements',coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from public.stock_movements m where (m.reference_type='sale' and m.reference_id=s.id) or (m.reference_type='sale_return' and m.reference_id in (select r.id from public.sale_returns r where r.sale_id=s.id))),'[]'::jsonb),
    'audit_events',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.audit_logs a where (a.entity_type='sales' and a.entity_id=s.id::text) or (a.entity_type='sale_returns' and a.entity_id in (select r.id::text from public.sale_returns r where r.sale_id=s.id))),'[]'::jsonb),
    'cashier',(select jsonb_build_object('id',p.id,'full_name',p.full_name) from public.profiles p where p.id=s.created_by)
  )::text from public.sales s where s.id=p_sale_id;
$$;

create function private.invoice_archive_sha256(p_text text) returns text language sql immutable strict set search_path='' as $$
  select encode(sha256(convert_to(p_text,'UTF8')),'hex');
$$;

create function private.invoice_archive_version(p_id uuid) returns jsonb language sql stable set search_path='' as $$
  select (to_jsonb(v)-array['canonical_before','canonical_after']) || jsonb_build_object('previous_object_key',p.object_key)
  from private.invoice_archive_versions v left join private.invoice_archive_versions p on p.id=v.previous_version_id where v.id=p_id;
$$;

-- One STABLE statement sees a consistent MVCC snapshot of this fixed batch.
-- No source locks are taken: checkout, refunds and inventory writes can proceed.
-- The full original ledger is retained, so a mutation after the final check is
-- safely picked up as a new workbook revision by the next run.
create function private.invoice_archive_source_fingerprints(p_candidates jsonb) returns jsonb
language sql stable set search_path='' as $$
  select coalesce(jsonb_object_agg(s.sale_id::text,jsonb_build_object(
    'source_sha256',private.invoice_archive_sha256(private.invoice_archive_payload(s.sale_id)),
    'pending_return',exists(select 1 from public.sale_returns r where r.sale_id=s.sale_id and r.status='requested')
  )),'{}'::jsonb)
  from (select (x->>'sale_id')::uuid sale_id from jsonb_array_elements(p_candidates) x) s;
$$;

create function private.invoice_archive_claim(p_force_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_settings private.invoice_archive_settings%rowtype; v_run private.invoice_archive_runs%rowtype;
begin
  perform private.invoice_archive_assert_service();
  if p_force_dry_run is null then raise exception 'Choose an archive run mode'; end if;
  select * into v_settings from private.invoice_archive_settings where singleton_id for update;
  if not v_settings.enabled and not p_force_dry_run then
    return jsonb_build_object('status','disabled','deletion_enabled',false,'generation',v_settings.generation);
  end if;
  update private.invoice_archive_runs set state='expired',finished_at=clock_timestamp(),batch_candidates='[]'::jsonb
    where state='running' and expires_at<=clock_timestamp();
  if exists(select 1 from private.invoice_archive_runs where state='running') then return jsonb_build_object('status','busy'); end if;
  update private.invoice_archive_settings set fence=fence+1,updated_at=clock_timestamp() where singleton_id returning * into v_settings;
  insert into private.invoice_archive_runs(fence,expected_generation,cutoff,dry_run)
    values(v_settings.fence,v_settings.generation,clock_timestamp()-interval '15 days',p_force_dry_run) returning * into v_run;
  return jsonb_build_object('status','claimed','lease',v_run.lease,'fence',v_run.fence,
    'generation',v_settings.generation,'expected_generation',v_settings.generation,'next_generation',v_settings.generation+1,
    'current_version',private.invoice_archive_version(v_settings.current_version_id),'dry_run',v_run.dry_run,
    'cutoff',v_run.cutoff,'expires_at',v_run.expires_at,'deletion_enabled',false);
end $$;

create function private.invoice_archive_batch(p_lease uuid,p_fence bigint,p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_run private.invoice_archive_runs%rowtype; v_settings private.invoice_archive_settings%rowtype; v_candidates jsonb;
  v_started_at timestamptz:=clock_timestamp();
begin
  perform private.invoice_archive_assert_service();
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Archive batch limit must be between 1 and 100'; end if;
  select * into v_settings from private.invoice_archive_settings where singleton_id for update;
  select * into v_run from private.invoice_archive_runs where lease=p_lease for update;
  if not found or v_run.fence is distinct from p_fence or v_settings.fence<>p_fence or v_run.state<>'running' or v_run.expires_at<=clock_timestamp()
    or v_run.expected_generation<>v_settings.generation then raise exception 'Archive lease expired or superseded' using errcode='40001'; end if;
  if not v_settings.enabled and not v_run.dry_run then raise exception 'Invoice archiving is disabled'; end if;
  v_candidates:=v_run.batch_candidates;
  if jsonb_array_length(v_candidates)=0 then
    with candidates as materialized (
      select s.id,s.completed_at,m.source_sha256 previous_source_sha256,private.invoice_archive_payload(s.id) payload_text
      from public.sales s left join private.invoice_archive_manifest m on m.sale_id=s.id
      where ((m.sale_id is null and s.status in ('completed','partially_refunded','refunded') and s.completed_at<v_run.cutoff) or m.sale_id is not null)
        and not exists(select 1 from public.sale_returns r where r.sale_id=s.id and r.status='requested')
    ), changed as (
      select *,private.invoice_archive_sha256(payload_text) source_sha256 from candidates
    ), selected as (
      select * from changed where previous_source_sha256 is distinct from source_sha256 order by completed_at,id limit p_limit
    )
    select coalesce(jsonb_agg(jsonb_build_object('sale_id',id,'completed_at',completed_at,'payload_text',payload_text,
      'source_sha256',source_sha256,'previous_source_sha256',previous_source_sha256) order by completed_at,id),'[]'::jsonb) into v_candidates from selected;
    update private.invoice_archive_runs set batch_candidates=v_candidates where lease=p_lease;
  end if;
  -- An elapsed guard rejects a slow scan before it publishes state. A real
  -- statement timer must be configured by the database/RPC caller; SET inside
  -- an already running SQL function cannot reliably arm that outer timer.
  if clock_timestamp()-v_started_at>interval '30 seconds' or v_run.expires_at<=clock_timestamp() then
    raise exception 'Archive source scan exceeded its execution window' using errcode='57014';
  end if;
  update private.invoice_archive_runs set last_heartbeat=clock_timestamp(),expires_at=clock_timestamp()+interval '5 minutes' where lease=p_lease;
  return jsonb_build_object('status',case when jsonb_array_length(v_candidates)>0 then 'ready' else 'empty' end,
    'lease',p_lease,'fence',p_fence,'expected_generation',v_settings.generation,'generation',v_settings.generation+1,
    'cutoff',v_run.cutoff,'dry_run',v_run.dry_run,'candidates',v_candidates,
    'has_more',jsonb_array_length(v_candidates)=p_limit,'current_version',private.invoice_archive_version(v_settings.current_version_id));
end $$;

create function private.invoice_archive_heartbeat(p_lease uuid,p_fence bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_run private.invoice_archive_runs%rowtype;
begin
  perform private.invoice_archive_assert_service();
  perform 1 from private.invoice_archive_settings where singleton_id and fence=p_fence for update;
  if not found then raise exception 'Archive fence superseded' using errcode='40001'; end if;
  update private.invoice_archive_runs set last_heartbeat=clock_timestamp(),expires_at=clock_timestamp()+interval '5 minutes'
    where lease=p_lease and fence=p_fence and state='running' and expires_at>clock_timestamp() returning * into v_run;
  if not found then raise exception 'Archive lease expired or superseded' using errcode='40001'; end if;
  return jsonb_build_object('status','renewed','expires_at',v_run.expires_at);
end $$;

create function private.invoice_archive_release(p_lease uuid,p_fence bigint,p_error text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_run private.invoice_archive_runs%rowtype;
begin
  perform private.invoice_archive_assert_service();
  perform 1 from private.invoice_archive_settings where singleton_id and fence=p_fence for update;
  if not found then raise exception 'Archive fence superseded' using errcode='40001'; end if;
  update private.invoice_archive_runs set state=case when p_error is not null then 'failed' when dry_run then 'dry_run' else 'released' end,
    finished_at=clock_timestamp(),batch_candidates='[]'::jsonb,last_error=left(p_error,500)
    where lease=p_lease and fence=p_fence and state='running' returning * into v_run;
  if not found then raise exception 'Archive lease is not active' using errcode='40001'; end if;
  return jsonb_build_object('status',v_run.state,'committed_versions',v_run.committed_versions,'deleted_count',0);
end $$;

create function private.invoice_archive_commit(p_lease uuid,p_fence bigint,p_expected_generation bigint,
  p_object_key text,p_sha256 text,p_size_bytes bigint,p_manifest jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_settings private.invoice_archive_settings%rowtype; v_run private.invoice_archive_runs%rowtype;
  v_version private.invoice_archive_versions%rowtype; v_expected jsonb; v_actual jsonb;
  v_before jsonb; v_after jsonb; v_source_expected jsonb; v_manifest_hash text;
  v_started_at timestamptz:=clock_timestamp();
begin
  perform private.invoice_archive_assert_service();
  if p_expected_generation is null or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_size_bytes is null or p_size_bytes<=0
    or p_object_key is distinct from ('versions/'||(p_expected_generation+1)::text||'/'||p_lease::text||'-'||p_sha256||'.xlsx') then
    raise exception 'Invalid immutable archive object metadata';
  end if;
  if jsonb_typeof(p_manifest) is distinct from 'array' or jsonb_array_length(p_manifest)=0 then raise exception 'A complete archive manifest is required'; end if;
  if exists(select 1 from jsonb_array_elements(p_manifest) x where jsonb_typeof(x)<>'object'
    or x->>'sale_id' is null or (x->>'sale_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or x->>'source_sha256' is null or (x->>'source_sha256') !~ '^[0-9a-f]{64}$'
    or (x-array['sale_id','source_sha256'])<>'{}'::jsonb)
    or exists(select 1 from jsonb_array_elements(p_manifest) x group by x->>'sale_id' having count(*)>1) then raise exception 'Invalid or duplicate archive manifest entries'; end if;
  select jsonb_agg(x order by x->>'sale_id') into v_actual from jsonb_array_elements(p_manifest) x;
  v_manifest_hash:=private.invoice_archive_sha256(v_actual::text);
  select * into v_settings from private.invoice_archive_settings where singleton_id for update;
  select * into v_run from private.invoice_archive_runs where lease=p_lease for update;
  -- An acknowledged commit can be retried after a lost HTTP response, including after release.
  select * into v_version from private.invoice_archive_versions where generation=p_expected_generation+1 and lease=p_lease and fence=p_fence;
  if found then
    if v_version.object_key is distinct from p_object_key or v_version.sha256 is distinct from p_sha256 or v_version.size_bytes is distinct from p_size_bytes or v_version.manifest_sha256<>v_manifest_hash then
      raise exception 'Archive generation already committed with different metadata' using errcode='40001';
    end if;
    return jsonb_build_object('status','committed','replayed',true,'generation',v_version.generation,'current_version',private.invoice_archive_version(v_version.id),'deleted_count',0,'retained_reason',v_version.retained_reason);
  end if;
  if v_run.lease is null or v_run.fence is distinct from p_fence or v_settings.fence<>p_fence or v_run.state<>'running'
    or v_run.expires_at<=clock_timestamp() or v_run.expected_generation<>p_expected_generation or v_settings.generation<>p_expected_generation then
    raise exception 'Archive lease expired or generation superseded' using errcode='40001';
  end if;
  if not v_settings.enabled or v_run.dry_run then raise exception 'Publishing disabled for this archive run'; end if;
  if jsonb_array_length(v_run.batch_candidates)=0 then raise exception 'Archive batch is empty'; end if;
  with expected as (
    select m.sale_id,m.source_sha256 from private.invoice_archive_manifest m
    where not exists(select 1 from jsonb_array_elements(v_run.batch_candidates) x where (x->>'sale_id')::uuid=m.sale_id)
    union all select (x->>'sale_id')::uuid,x->>'source_sha256' from jsonb_array_elements(v_run.batch_candidates) x
  ) select jsonb_agg(jsonb_build_object('sale_id',sale_id,'source_sha256',source_sha256) order by sale_id) into v_expected from expected;
  if v_actual is distinct from v_expected then raise exception 'Archive manifest must preserve all previous invoices and exactly match the fixed batch'; end if;

  select jsonb_object_agg(x->>'sale_id',jsonb_build_object('source_sha256',x->>'source_sha256','pending_return',false))
    into v_source_expected from jsonb_array_elements(v_run.batch_candidates) x;
  v_before:=private.invoice_archive_source_fingerprints(v_run.batch_candidates);
  if v_before is distinct from v_source_expected then
    raise exception 'Archive source changed after export; rebuild from a fresh batch' using errcode='40001';
  end if;
  if clock_timestamp()-v_started_at>interval '30 seconds' or v_run.expires_at<=clock_timestamp() then
    raise exception 'Archive source verification exceeded its execution window' using errcode='57014';
  end if;
  insert into private.invoice_archive_versions(generation,lease,fence,object_key,sha256,size_bytes,invoice_count,manifest_sha256,previous_version_id,canonical_before,canonical_after)
    values(p_expected_generation+1,p_lease,p_fence,p_object_key,p_sha256,p_size_bytes,jsonb_array_length(p_manifest),v_manifest_hash,v_settings.current_version_id,v_before,v_before)
    returning * into v_version;
  insert into private.invoice_archive_manifest(sale_id,source_sha256,first_generation,generation)
    select (x->>'sale_id')::uuid,x->>'source_sha256',v_version.generation,v_version.generation from jsonb_array_elements(v_run.batch_candidates) x
    on conflict(sale_id) do update set source_sha256=excluded.source_sha256,generation=excluded.generation,archived_at=clock_timestamp();
  update private.invoice_archive_settings set generation=v_version.generation,current_version_id=v_version.id,updated_at=clock_timestamp() where singleton_id;
  update private.invoice_archive_runs set expected_generation=v_version.generation,batch_candidates='[]'::jsonb,
    committed_versions=committed_versions+1,last_heartbeat=clock_timestamp(),expires_at=clock_timestamp()+interval '5 minutes' where lease=p_lease;
  v_after:=private.invoice_archive_source_fingerprints(v_run.batch_candidates);
  if v_before is distinct from v_after then raise exception 'Archive source changed during publication; rebuild from a fresh batch' using errcode='40001'; end if;
  if clock_timestamp()-v_started_at>interval '30 seconds' or v_run.expires_at<=clock_timestamp() then
    raise exception 'Archive source verification exceeded its execution window' using errcode='57014';
  end if;
  -- Metadata is the only data written. A later source mutation remains in the
  -- ordinary operational ledger and is appended on the next successful run.
  return jsonb_build_object('status','committed','replayed',false,'generation',v_version.generation,
    'current_version',private.invoice_archive_version(v_version.id),'deleted_count',0,'retained_reason',v_version.retained_reason,
    'canonical_unchanged',true);
end $$;

create function private.invoice_archive_current() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  perform private.invoice_archive_assert_service();
  select current_version_id into v_id from private.invoice_archive_settings where singleton_id;
  return private.invoice_archive_version(v_id);
end $$;

create function public.invoice_archive_claim(p_force_dry_run boolean default false) returns jsonb language sql security invoker set search_path='' as $$ select private.invoice_archive_claim(p_force_dry_run) $$;
create function public.invoice_archive_current() returns jsonb language sql security invoker set search_path='' as $$ select private.invoice_archive_current() $$;
create function public.invoice_archive_batch(p_lease uuid,p_fence bigint,p_limit integer default 25) returns jsonb language sql security invoker set search_path='' as $$ select private.invoice_archive_batch(p_lease,p_fence,p_limit) $$;
create function public.invoice_archive_commit(p_lease uuid,p_fence bigint,p_expected_generation bigint,p_object_key text,p_sha256 text,p_size_bytes bigint,p_manifest jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.invoice_archive_commit(p_lease,p_fence,p_expected_generation,p_object_key,p_sha256,p_size_bytes,p_manifest) $$;
create function public.invoice_archive_heartbeat(p_lease uuid,p_fence bigint) returns jsonb language sql security invoker set search_path='' as $$ select private.invoice_archive_heartbeat(p_lease,p_fence) $$;
create function public.invoice_archive_release(p_lease uuid,p_fence bigint,p_error text default null) returns jsonb language sql security invoker set search_path='' as $$ select private.invoice_archive_release(p_lease,p_fence,p_error) $$;

revoke all on function private.invoice_archive_assert_service(),private.invoice_archive_payload(uuid),private.invoice_archive_sha256(text),private.invoice_archive_version(uuid),private.invoice_archive_source_fingerprints(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.invoice_archive_claim(boolean),private.invoice_archive_current(),private.invoice_archive_batch(uuid,bigint,integer),private.invoice_archive_commit(uuid,bigint,bigint,text,text,bigint,jsonb),private.invoice_archive_heartbeat(uuid,bigint),private.invoice_archive_release(uuid,bigint,text) from public,anon,authenticated;
revoke all on function public.invoice_archive_claim(boolean),public.invoice_archive_current(),public.invoice_archive_batch(uuid,bigint,integer),public.invoice_archive_commit(uuid,bigint,bigint,text,text,bigint,jsonb),public.invoice_archive_heartbeat(uuid,bigint),public.invoice_archive_release(uuid,bigint,text) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.invoice_archive_claim(boolean),private.invoice_archive_current(),private.invoice_archive_batch(uuid,bigint,integer),private.invoice_archive_commit(uuid,bigint,bigint,text,text,bigint,jsonb),private.invoice_archive_heartbeat(uuid,bigint),private.invoice_archive_release(uuid,bigint,text) to service_role;
grant execute on function public.invoice_archive_claim(boolean),public.invoice_archive_current(),public.invoice_archive_batch(uuid,bigint,integer),public.invoice_archive_commit(uuid,bigint,bigint,text,text,bigint,jsonb),public.invoice_archive_heartbeat(uuid,bigint),public.invoice_archive_release(uuid,bigint,text) to service_role;

-- Supabase Storage is absent in the standalone PostgreSQL test database.
-- On Supabase this provisions only a private bucket; existing buckets/policies stay intact.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    execute $bucket$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('invoice-archives','invoice-archives',false,33554432,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
      on conflict(id) do nothing$bucket$;
    if exists(select 1 from storage.buckets where id='invoice-archives' and public) then
      raise exception 'Existing invoice-archives bucket must be private before applying this migration';
    end if;
  end if;
  if to_regclass('storage.objects') is not null then
    execute $policy$create policy invoice_archive_objects_private on storage.objects as restrictive for all to anon,authenticated
      using (bucket_id <> 'invoice-archives') with check (bucket_id <> 'invoice-archives')$policy$;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
