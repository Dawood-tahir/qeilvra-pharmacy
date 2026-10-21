-- Additive to the verified archive protocol. Activation is deliberately separate.
-- Original financial formulas are preserved; only their line-item read source changes.
begin;

create table private.invoice_item_presentations (
  id bigint generated always as identity primary key,
  signature text not null unique,
  medicine_name text not null,
  medicine_sku text not null,
  unit_label text
);

-- Active invoices need only a foreign-key anchor here. Numeric fields are filled
-- once, atomically, when the verified original line is deleted from sale_items.
create table private.invoice_item_ledger (
  id uuid primary key,
  sale_id uuid not null references public.sales(id),
  medicine_id uuid not null references public.medicines(id),
  quantity numeric(12,3), unit_price numeric(14,2), line_total numeric(14,2),
  created_at timestamptz, selling_unit text, net_line_total numeric(14,2),
  base_units_per_sale_unit integer, base_quantity numeric(12,3), item_discount numeric(14,2),
  presentation_id bigint references private.invoice_item_presentations(id),
  archived boolean not null default false,
  check (not archived or (quantity is not null and quantity>0 and unit_price is not null and unit_price>=0
    and line_total is not null and line_total>=0 and created_at is not null and presentation_id is not null
    and item_discount is not null and item_discount between 0 and line_total)),
  check (base_units_per_sale_unit is null or base_units_per_sale_unit>0),
  check (net_line_total is null or net_line_total>=0)
);
create index invoice_item_ledger_sale_idx on private.invoice_item_ledger(sale_id);
create index invoice_item_ledger_presentation_idx on private.invoice_item_ledger(presentation_id) where archived;
create unique index invoice_item_ledger_unit_key on private.invoice_item_ledger(sale_id,medicine_id,selling_unit) where selling_unit is not null;
insert into private.invoice_item_ledger(id,sale_id,medicine_id,selling_unit) select id,sale_id,medicine_id,selling_unit from public.sale_items;

alter table private.invoice_item_ledger enable row level security;
alter table private.invoice_item_presentations enable row level security;
revoke all on private.invoice_item_ledger,private.invoice_item_presentations from public,anon,authenticated,service_role;
create policy invoice_ledger_read on private.invoice_item_ledger for select to authenticated using (
  exists(select 1 from public.sales s where s.id=sale_id and (public.is_owner() or s.created_by=auth.uid()))
);
create policy invoice_presentation_read on private.invoice_item_presentations for select to authenticated using (
  exists(select 1 from private.invoice_item_ledger l where l.presentation_id=invoice_item_presentations.id)
);
grant select on private.invoice_item_ledger,private.invoice_item_presentations to authenticated;

create function private.invoice_item_anchor() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.id<>old.id then raise exception 'Invoice line identities are immutable'; end if;
  insert into private.invoice_item_ledger(id,sale_id,medicine_id,selling_unit) values(new.id,new.sale_id,new.medicine_id,new.selling_unit)
    on conflict(id) do update set sale_id=excluded.sale_id,medicine_id=excluded.medicine_id,selling_unit=excluded.selling_unit
      where not invoice_item_ledger.archived;
  if not found then raise exception 'An archived invoice line cannot be duplicated in active storage'; end if;
  return new;
end $$;
revoke all on function private.invoice_item_anchor() from public,anon,authenticated,service_role;
create trigger invoice_item_anchor before insert or update on public.sale_items
  for each row execute function private.invoice_item_anchor();

-- No cascading delete: costs, batches and refund allocations retain their identities.
alter table public.sale_item_costs drop constraint sale_item_costs_sale_item_id_fkey;
alter table public.sale_item_costs add constraint sale_item_costs_sale_item_id_fkey
  foreign key(sale_item_id) references private.invoice_item_ledger(id);
alter table public.return_items drop constraint return_items_sale_item_id_fkey;
alter table public.return_items add constraint return_items_sale_item_id_fkey
  foreign key(sale_item_id) references private.invoice_item_ledger(id);

-- Disjoint active/history branches prevent double-counting even inside a pruning
-- transaction. RLS follows the caller, including for PostgREST receipt embedding.
create view public.invoice_item_rows with (security_invoker=true) as
select id,sale_id,medicine_id,medicine_name,medicine_sku,quantity,unit_price,line_total,created_at,
  selling_unit,net_line_total,unit_label,base_units_per_sale_unit,base_quantity,item_discount
from public.sale_items
union all
select l.id,l.sale_id,l.medicine_id,p.medicine_name,p.medicine_sku,l.quantity,l.unit_price,l.line_total,l.created_at,
  l.selling_unit,l.net_line_total,p.unit_label,l.base_units_per_sale_unit,l.base_quantity,l.item_discount
from private.invoice_item_ledger l join private.invoice_item_presentations p on p.id=l.presentation_id
where l.archived and not exists(select 1 from public.sale_items a where a.id=l.id);
revoke all on public.invoice_item_rows from public,anon,authenticated,service_role;
grant select on public.invoice_item_rows to authenticated;

-- Preserve the existing sale_items(...) receipt/count embedding without UI changes.
create function public.sale_items(public.sales) returns setof public.invoice_item_rows
language sql stable security invoker set search_path='' as $$
  select * from public.invoice_item_rows where sale_id=$1.id;
$$;
revoke all on function public.sale_items(public.sales) from public,anon,authenticated,service_role;
grant execute on function public.sale_items(public.sales) to authenticated;

-- Rewrite relation references, never arithmetic, rounding, date boundaries or
-- permissions. POS INSERTs still target the original active table. Returns lock
-- the parent sale before reading lines, so their redundant line FOR UPDATE is
-- removed (UNION views cannot be locked). Pruning takes that same parent lock.
create table private.invoice_ledger_function_migrations (
  signature text primary key, previous_definition text not null, installed_definition text not null
);
revoke all on private.invoice_ledger_function_migrations from public,anon,authenticated,service_role;
do $$ declare f record; v_before text; v_after text; begin
  for f in select p.oid,p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f' and p.prosrc like '%public.sale_items%'
  loop
    v_before:=pg_get_functiondef(f.oid);
    v_after:=replace(v_before,'public.sale_items','public.invoice_item_rows');
    v_after:=replace(v_after,'insert into public.invoice_item_rows','insert into public.sale_items');
    v_after:=replace(v_after,'from public.invoice_item_rows where id = v_return_item.sale_item_id for update',
      'from public.invoice_item_rows where id = v_return_item.sale_item_id');
    if v_after<>v_before then
      execute v_after;
      insert into private.invoice_ledger_function_migrations values(f.signature,v_before,v_after);
    end if;
  end loop;
end $$;

-- The old migration's structural block is replaced with two explicit deployment
-- gates (database setting + server env). Both stay false until Owner approval.
alter table private.invoice_archive_settings drop constraint invoice_archive_settings_deletion_enabled_check;
update private.invoice_archive_settings set deletion_enabled=false;
create table private.invoice_archive_prunes (
  operation_id uuid primary key,
  lease uuid not null references private.invoice_archive_runs(lease),
  generation bigint not null references private.invoice_archive_versions(generation),
  fence bigint not null, sha256 text not null, batch_limit integer not null,
  source_bytes bigint not null, ledger_bytes bigint not null,
  deleted_count bigint not null, invoice_count bigint not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.invoice_archive_prunes enable row level security;
revoke all on private.invoice_archive_prunes from public,anon,authenticated,service_role;

create function private.invoice_item_delete_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.invoice_archive_assert_service();
  if nullif(current_setting('qeilvra.invoice_prune',true),'') is null
    or not exists(select 1 from private.invoice_item_ledger l where l.id=old.id and l.archived)
    or not exists(select 1 from private.invoice_archive_settings where singleton_id and enabled and deletion_enabled) then
    raise exception 'Invoice details may only be deleted by the verified archive protocol' using errcode='42501';
  end if;
  return old;
end $$;
revoke all on function private.invoice_item_delete_guard() from public,anon,authenticated,service_role;
create trigger invoice_item_delete_guard before delete on public.sale_items
  for each row execute function private.invoice_item_delete_guard();

create function private.invoice_archive_prune(p_lease uuid,p_fence bigint,p_generation bigint,p_sha256 text,
  p_operation_id uuid,p_limit integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_settings private.invoice_archive_settings%rowtype; v_run private.invoice_archive_runs%rowtype;
  v_version private.invoice_archive_versions%rowtype; v_previous private.invoice_archive_prunes%rowtype;
  v_sale record; v_item public.sale_items%rowtype; v_signature text; v_presentation bigint;
  v_before text; v_count bigint:=0; v_invoices bigint:=0; v_source_bytes bigint:=0; v_ledger_bytes bigint:=0;
  v_started timestamptz:=clock_timestamp(); v_deleted bigint; v_old_context text;
begin
  perform private.invoice_archive_assert_service();
  if p_operation_id is null or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid prune operation'; end if;
  select * into v_settings from private.invoice_archive_settings where singleton_id for update;
  select * into v_previous from private.invoice_archive_prunes where operation_id=p_operation_id;
  if found then
    if v_previous.lease is distinct from p_lease or v_previous.generation is distinct from p_generation
      or v_previous.fence is distinct from p_fence or v_previous.sha256 is distinct from p_sha256 or v_previous.batch_limit is distinct from p_limit then
      raise exception 'Prune operation key already used';
    end if;
    return jsonb_build_object('status','pruned','replayed',true,'deleted_count',v_previous.deleted_count,'invoices_pruned',v_previous.invoice_count,'has_more',v_previous.invoice_count>=v_previous.batch_limit);
  end if;
  select * into v_run from private.invoice_archive_runs where lease=p_lease for update;
  if v_run.lease is null or v_run.fence is distinct from p_fence or v_settings.fence<>p_fence or v_run.state<>'running'
    or v_run.expires_at<=clock_timestamp() or v_settings.generation is distinct from p_generation then
    raise exception 'Prune lease expired or superseded' using errcode='40001';
  end if;
  if not v_settings.enabled or not v_settings.deletion_enabled or v_run.dry_run then
    return jsonb_build_object('status','deletion_disabled','deleted_count',0,'invoices_pruned',0);
  end if;
  -- A future invoice column/type needs an explicit ledger/archive migration.
  -- Never delete a new detail that this retained representation cannot reproduce.
  if (select jsonb_object_agg(attname,format_type(atttypid,atttypmod)) from pg_attribute
        where attrelid='public.sale_items'::regclass and attnum>0 and not attisdropped)
    is distinct from (select jsonb_object_agg(attname,format_type(atttypid,atttypmod)) from pg_attribute
        where attrelid='public.invoice_item_rows'::regclass and attnum>0 and not attisdropped) then
    raise exception 'Invoice ledger schema changed; deletion requires a reviewed migration';
  end if;
  select * into v_version from private.invoice_archive_versions where id=v_settings.current_version_id;
  if v_version.sha256 is distinct from p_sha256 or v_version.generation is distinct from p_generation then
    raise exception 'Pruning requires the independently verified current workbook';
  end if;
  v_old_context:=current_setting('qeilvra.invoice_prune',true);
  perform set_config('qeilvra.invoice_prune',p_operation_id::text,true);
  for v_sale in
    select s.id,m.source_sha256 from public.sales s join private.invoice_archive_manifest m on m.sale_id=s.id
    where s.completed_at<v_run.cutoff and s.status in ('completed','partially_refunded','refunded')
      and exists(select 1 from public.sale_items i where i.sale_id=s.id)
      and not exists(select 1 from public.sale_returns r where r.sale_id=s.id and r.status='requested')
      and private.invoice_archive_sha256(private.invoice_archive_payload(s.id))=m.source_sha256
    order by s.completed_at,s.id limit p_limit for update of s skip locked
  loop
    if clock_timestamp()-v_started>interval '30 seconds' then exit; end if;
    -- Same sale lock used by every refund path. Check again after acquiring it.
    if exists(select 1 from public.sale_returns r where r.sale_id=v_sale.id and r.status='requested') then continue; end if;
    perform 1 from public.sale_items where sale_id=v_sale.id order by id for update;
    v_before:=private.invoice_archive_payload(v_sale.id);
    if private.invoice_archive_sha256(v_before) is distinct from v_sale.source_sha256 then continue; end if;
    for v_item in select * from public.sale_items where sale_id=v_sale.id order by id loop
      v_source_bytes:=v_source_bytes+pg_column_size(v_item);
      v_signature:=private.invoice_archive_sha256(jsonb_build_array(v_item.medicine_name,v_item.medicine_sku,v_item.unit_label)::text);
      insert into private.invoice_item_presentations(signature,medicine_name,medicine_sku,unit_label)
        values(v_signature,v_item.medicine_name,v_item.medicine_sku,v_item.unit_label) on conflict(signature) do nothing;
      select id into v_presentation from private.invoice_item_presentations where signature=v_signature
        and medicine_name=v_item.medicine_name and medicine_sku=v_item.medicine_sku and unit_label is not distinct from v_item.unit_label;
      if v_presentation is null then raise exception 'Invoice presentation digest collision'; end if;
      update private.invoice_item_ledger set quantity=v_item.quantity,unit_price=v_item.unit_price,line_total=v_item.line_total,
        created_at=v_item.created_at,selling_unit=v_item.selling_unit,net_line_total=v_item.net_line_total,
        base_units_per_sale_unit=v_item.base_units_per_sale_unit,base_quantity=v_item.base_quantity,item_discount=v_item.item_discount,
        presentation_id=v_presentation,archived=true where id=v_item.id and sale_id=v_item.sale_id and medicine_id=v_item.medicine_id and not archived;
      if not found then raise exception 'Invoice ledger identity mismatch'; end if;
      v_ledger_bytes:=v_ledger_bytes+(select pg_column_size(l) from private.invoice_item_ledger l where id=v_item.id);
    end loop;
    delete from public.sale_items where sale_id=v_sale.id;
    get diagnostics v_deleted=row_count;
    if private.invoice_archive_payload(v_sale.id) is distinct from v_before then
      raise exception 'Invoice ledger reconciliation failed; deletion rolled back';
    end if;
    v_count:=v_count+v_deleted; v_invoices:=v_invoices+1;
  end loop;
  if v_run.expires_at<=clock_timestamp() then raise exception 'Prune lease expired during verification' using errcode='40001'; end if;
  perform set_config('qeilvra.invoice_prune',coalesce(v_old_context,''),true);
  insert into private.invoice_archive_prunes(operation_id,lease,generation,fence,sha256,batch_limit,source_bytes,ledger_bytes,deleted_count,invoice_count)
    values(p_operation_id,p_lease,p_generation,p_fence,p_sha256,p_limit,v_source_bytes,v_ledger_bytes,v_count,v_invoices);
  return jsonb_build_object('status','pruned','replayed',false,'deleted_count',v_count,'invoices_pruned',v_invoices,
    'source_row_bytes',v_source_bytes,'retained_row_bytes',v_ledger_bytes,'has_more',v_invoices>=p_limit);
end $$;
create function public.invoice_archive_prune(p_lease uuid,p_fence bigint,p_generation bigint,p_sha256 text,p_operation_id uuid,p_limit integer default 25)
returns jsonb language sql security invoker set search_path='' as $$
  select private.invoice_archive_prune(p_lease,p_fence,p_generation,p_sha256,p_operation_id,p_limit);
$$;
revoke all on function private.invoice_archive_prune(uuid,bigint,bigint,text,uuid,integer),public.invoice_archive_prune(uuid,bigint,bigint,text,uuid,integer)
  from public,anon,authenticated;
grant execute on function private.invoice_archive_prune(uuid,bigint,bigint,text,uuid,integer),public.invoice_archive_prune(uuid,bigint,bigint,text,uuid,integer) to service_role;

-- Normal autovacuum makes deleted active rows/index entries reusable; no table
-- rewrite, VACUUM FULL, global locks or stock recalculation is performed.
alter table public.sale_items set (autovacuum_vacuum_scale_factor=0.05,autovacuum_vacuum_threshold=50);
notify pgrst,'reload schema';
commit;
