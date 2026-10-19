-- Requires approval. Existing stock movements and receiving functions are reused.
begin;
create table public.stock_dispositions (
 id uuid primary key,
 kind text not null check(kind in ('discard','supplier_return')),
 batch_id uuid not null references public.medicine_batches(id),
 medicine_id uuid not null references public.medicines(id),
 medicine_name text not null, batch_number text not null, base_unit text not null,
 quantity bigint not null check(quantity between 1 and 999999999),
 unit_cost numeric(14,4) not null check(unit_cost>=0 and unit_cost<=9999999999.9999),
 cost_value numeric generated always as (quantity*unit_cost) stored,
 supplier_id uuid references public.suppliers(id), purchase_id uuid references public.purchases(id),
 reason text not null check(char_length(reason) between 3 and 500),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 request_data jsonb not null,
 recovery_state text not null check(recovery_state in ('not_applicable','pending','confirmed')),
 recovery_method text check(recovery_method in ('refund','credit','replacement')),
 recovery_amount numeric(14,2) not null default 0 check(recovery_amount>=0),
 recovery_key uuid unique, recovery_request jsonb, recovery_reference text check(char_length(recovery_reference)<=120),
 confirmed_at timestamptz, confirmed_by uuid references public.profiles(id),
 replacement_purchase_id uuid unique references public.purchases(id),
 constraint disposition_state_check check (
  (kind='discard' and recovery_state='not_applicable' and recovery_method is null and recovery_key is null and recovery_amount=0 and confirmed_at is null and confirmed_by is null and replacement_purchase_id is null)
  or (kind='supplier_return' and supplier_id is not null and recovery_method is not null and (
   (recovery_state='pending' and recovery_key is null and recovery_amount=0 and confirmed_at is null and confirmed_by is null and replacement_purchase_id is null)
   or (recovery_state='confirmed' and recovery_key is not null and recovery_request is not null and confirmed_at is not null and confirmed_by is not null and ((recovery_method='replacement' and replacement_purchase_id is not null) or (recovery_method<>'replacement' and replacement_purchase_id is null)))
  ))
 )
);
alter table public.stock_dispositions enable row level security;
revoke all on public.stock_dispositions from public,anon,authenticated;
grant select on public.stock_dispositions to authenticated;
create policy stock_dispositions_owner_read on public.stock_dispositions for select to authenticated using(public.is_owner());
create index stock_dispositions_supplier_idx on public.stock_dispositions(supplier_id,created_at desc);
create index stock_dispositions_purchase_idx on public.stock_dispositions(purchase_id);
create index stock_dispositions_created_idx on public.stock_dispositions(created_at);
create index stock_dispositions_confirmed_idx on public.stock_dispositions(confirmed_at) where recovery_state='confirmed';
create unique index stock_dispositions_movement_idx on public.stock_movements(reference_id) where reference_type='stock_disposition';

create function public.dispose_stock(p_key uuid,p_batch_id uuid,p_kind text,p_quantity bigint,p_expected_quantity numeric,p_reason text,p_supplier_id uuid default null,p_method text default 'credit')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_batch public.medicine_batches%rowtype; v_existing public.stock_dispositions%rowtype; v_mid uuid;
 v_m public.medicines%rowtype; v_supplier uuid; v_purchase uuid; v_request jsonb; v_after numeric;
begin
 if public.is_owner() is distinct from true then raise exception 'Owner permission required' using errcode='42501'; end if;
 if p_key is null or p_batch_id is null or p_kind is null or p_kind not in ('discard','supplier_return') or p_quantity is null or p_quantity not between 1 and 999999999 or char_length(trim(coalesce(p_reason,''))) not between 3 and 500 or p_method is null or p_method not in ('credit','refund','replacement') then raise exception 'Check the quantity, reason and stock action.'; end if;
 v_request:=jsonb_build_object('batch',p_batch_id,'kind',p_kind,'quantity',p_quantity,'expected',p_expected_quantity,'reason',trim(p_reason),'supplier',p_supplier_id,'method',p_method);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key::text,14));
 select * into v_existing from public.stock_dispositions where id=p_key;
 if found then
  if v_existing.created_by<>auth.uid() or v_existing.request_data is distinct from v_request then raise exception 'Request key already used with different details.'; end if;
  return jsonb_build_object('id',v_existing.id,'quantity',(select quantity_after from public.stock_movements where reference_type='stock_disposition' and reference_id=p_key),'value',round(v_existing.cost_value,2));
 end if;
 select medicine_id into v_mid from public.medicine_batches where id=p_batch_id;
 if not found then raise exception 'Batch not found.'; end if;
 -- Same medicine-before-batch order as checkout and returns.
 select * into v_m from public.medicines where id=v_mid for update;
 select * into v_batch from public.medicine_batches where id=p_batch_id for update;
 if v_batch.quantity_on_hand is distinct from p_expected_quantity then raise exception 'Stock changed. Refresh this batch and check its quantity before continuing.'; end if;
 if p_quantity>v_batch.quantity_on_hand then raise exception 'Quantity exceeds the stock remaining in this batch.'; end if;
 if v_batch.purchase_cost::text in ('NaN','Infinity','-Infinity') then raise exception 'This batch has an invalid recorded purchase cost. Check its original purchase.'; end if;
 select pi.purchase_id,p.supplier_id into v_purchase,v_supplier from public.purchase_items pi join public.purchases p on p.id=pi.purchase_id where pi.id=v_batch.purchase_item_id;
 v_supplier:=coalesce(v_batch.supplier_id,v_supplier);
 if p_kind='supplier_return' then
  if v_supplier is not null and p_supplier_id is distinct from v_supplier then raise exception 'Use the supplier recorded for this batch.'; end if;
  v_supplier:=coalesce(v_supplier,p_supplier_id);
  if v_supplier is null or not exists(select 1 from public.suppliers where id=v_supplier) then raise exception 'Select the supplier accepting this return.'; end if;
 end if;
 update public.medicine_batches set quantity_on_hand=quantity_on_hand-p_quantity where id=p_batch_id returning quantity_on_hand into v_after;
 insert into public.stock_dispositions(id,kind,batch_id,medicine_id,medicine_name,batch_number,base_unit,quantity,unit_cost,supplier_id,purchase_id,reason,created_by,request_data,recovery_state,recovery_method)
 values(p_key,p_kind,p_batch_id,v_mid,concat_ws(' ',v_m.name,nullif(v_m.strength,'')),v_batch.batch_number,v_m.base_unit,p_quantity,v_batch.purchase_cost,v_supplier,v_purchase,trim(p_reason),auth.uid(),v_request,case when p_kind='discard' then 'not_applicable' else 'pending' end,case when p_kind='supplier_return' then p_method else null end);
 insert into public.stock_movements(medicine_id,batch_id,kind,quantity_delta,quantity_after,reference_type,reference_id,reason,metadata,performed_by)
 values(v_mid,p_batch_id,'adjustment',-p_quantity,v_after,'stock_disposition',p_key,trim(p_reason),jsonb_build_object('stock_action',p_kind,'unit_cost',v_batch.purchase_cost,'cost_value',p_quantity*v_batch.purchase_cost,'supplier_id',v_supplier,'purchase_id',v_purchase),auth.uid());
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data) values(auth.uid(),p_kind,'stock_dispositions',p_key::text,v_request||jsonb_build_object('unit_cost',v_batch.purchase_cost,'stock_after',v_after));
 return jsonb_build_object('id',p_key,'quantity',v_after,'value',round(p_quantity*v_batch.purchase_cost,2));
end $$;

create function public.confirm_supplier_recovery(p_key uuid,p_id uuid,p_method text,p_amount numeric,p_reference text default '',p_replacement jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.stock_dispositions%rowtype; v_request jsonb; v_received jsonb; v_purchase uuid;
begin
 if public.is_owner() is distinct from true then raise exception 'Owner permission required' using errcode='42501'; end if;
 if p_key is null or p_id is null or p_method is null or p_method not in ('refund','credit','replacement') or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<0 or p_amount>999999999999.99 or p_amount<>round(p_amount,2) or char_length(coalesce(p_reference,''))>120 then raise exception 'Check the actual supplier settlement amount and method.'; end if;
 v_request:=jsonb_build_object('id',p_id,'method',p_method,'amount',p_amount,'reference',trim(coalesce(p_reference,'')),'replacement',p_replacement);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key::text,15));
 select * into v_row from public.stock_dispositions where recovery_key=p_key;
 if found then
  if v_row.confirmed_by<>auth.uid() or v_row.recovery_request is distinct from v_request then raise exception 'Settlement key already used with different details.'; end if;
  return jsonb_build_object('id',v_row.id);
 end if;
 select * into v_row from public.stock_dispositions where id=p_id for update;
 if not found or v_row.kind<>'supplier_return' then raise exception 'Supplier return not found.'; end if;
 if v_row.recovery_state<>'pending' then raise exception 'This supplier return has already been settled.'; end if;
 if p_method='replacement' then
  if jsonb_typeof(p_replacement) is distinct from 'object' or exists(select 1 from public.stock_receipts where request_key=p_key) then raise exception 'Enter a new replacement batch and a fresh settlement request.'; end if;
  v_received:=private.receive_stock(v_row.medicine_id,p_replacement||jsonb_build_object('unit_key','base','total_cost',p_amount,'supplier_id',v_row.supplier_id),p_key);
  v_purchase:=(v_received->>'purchase_id')::uuid;
  update public.purchases set notes='Supplier replacement for stock return '||p_id::text||'. No additional payment recorded.' where id=v_purchase;
 end if;
 update public.stock_dispositions set recovery_state='confirmed',recovery_method=p_method,recovery_amount=p_amount,recovery_key=p_key,recovery_request=v_request,recovery_reference=nullif(trim(p_reference),''),confirmed_at=now(),confirmed_by=auth.uid(),replacement_purchase_id=v_purchase where id=p_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,old_data,new_data) values(auth.uid(),'confirm_supplier_recovery','stock_dispositions',p_id::text,to_jsonb(v_row),v_request||jsonb_build_object('replacement_purchase_id',v_purchase));
 return jsonb_build_object('id',p_id);
end $$;
revoke all on function public.dispose_stock(uuid,uuid,text,bigint,numeric,text,uuid,text),public.confirm_supplier_recovery(uuid,uuid,text,numeric,text,jsonb) from public,anon;
grant execute on function public.dispose_stock(uuid,uuid,text,bigint,numeric,text,uuid,text),public.confirm_supplier_recovery(uuid,uuid,text,numeric,text,jsonb) to authenticated;

-- Preserve the existing sales/refund/COGS query and layer inventory losses below gross profit.
alter function public.owner_financial_analytics(date,date,text,boolean) set schema private;
alter function private.owner_financial_analytics(date,date,text,boolean) rename to sales_financial_analytics;
revoke all on function private.sales_financial_analytics(date,date,text,boolean) from public,anon,authenticated;
create function public.owner_financial_analytics(p_from date,p_to date,p_granularity text default 'day',p_include_inventory boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_base jsonb; v_details jsonb; v_metrics jsonb; v_daily jsonb;
begin
 if public.is_owner() is distinct from true then raise exception 'Owner permission required' using errcode='42501'; end if;
 v_base:=private.sales_financial_analytics(p_from,p_to,p_granularity,p_include_inventory);
 with inventory_events as (
  select created_at at time zone 'Asia/Karachi' local_time,case when kind='discard' then cost_value else 0 end written_off,case when kind='supplier_return' then cost_value else 0 end returned_value,0::numeric recovered,0::numeric replaced
  from public.stock_dispositions where created_at >= p_from::timestamp at time zone 'Asia/Karachi' and created_at < (p_to+1)::timestamp at time zone 'Asia/Karachi'
  union all
  select confirmed_at at time zone 'Asia/Karachi',0,0,case when recovery_method in ('refund','credit') then recovery_amount else 0 end,case when recovery_method='replacement' then recovery_amount else 0 end
  from public.stock_dispositions where recovery_state='confirmed' and confirmed_at >= p_from::timestamp at time zone 'Asia/Karachi' and confirmed_at < (p_to+1)::timestamp at time zone 'Asia/Karachi'
 ), daily_values as (
  select local_time::date day_key,
   round(sum(sum(written_off)) over(order by local_time::date),2)-round(coalesce(sum(sum(written_off)) over(order by local_time::date rows between unbounded preceding and 1 preceding),0),2) stock_written_off,
   round(sum(sum(returned_value)) over(order by local_time::date),2)-round(coalesce(sum(sum(returned_value)) over(order by local_time::date rows between unbounded preceding and 1 preceding),0),2) supplier_returns_value,
   sum(recovered) supplier_recoveries,sum(replaced) supplier_replacements_value from inventory_events group by local_time::date
 ), days as (
  select *,stock_written_off+supplier_returns_value-supplier_recoveries-supplier_replacements_value net_inventory_loss from daily_values
 ) select jsonb_build_object('metrics',jsonb_build_object('stock_written_off',coalesce(sum(stock_written_off),0),'supplier_returns_value',coalesce(sum(supplier_returns_value),0),'supplier_recoveries',coalesce(sum(supplier_recoveries),0),'supplier_replacements_value',coalesce(sum(supplier_replacements_value),0),'net_inventory_loss',coalesce(sum(net_inventory_loss),0)),
  'days',coalesce(jsonb_object_agg(day_key::text,to_jsonb(d)),'{}'::jsonb)) into v_details from days d;
 v_metrics:=(v_base->'metrics')||(v_details->'metrics')||jsonb_build_object('net_operating_profit',(v_base->'metrics'->>'net_operating_profit')::numeric-(v_details->'metrics'->>'net_inventory_loss')::numeric);
 select jsonb_agg(item||coalesce(v_details->'days'->(item->>'sale_date'),jsonb_build_object('stock_written_off',0,'supplier_returns_value',0,'supplier_recoveries',0,'supplier_replacements_value',0,'net_inventory_loss',0))||jsonb_build_object('net_operating_profit',(item->>'net_operating_profit')::numeric-coalesce((v_details->'days'->(item->>'sale_date')->>'net_inventory_loss')::numeric,0)) order by item->>'sale_date') into v_daily from jsonb_array_elements(v_base->'daily') item;
 return v_base||jsonb_build_object('metrics',v_metrics,'daily',v_daily,'trend',case when p_granularity='day' then v_daily else v_base->'trend' end);
end $$;
revoke all on function public.owner_financial_analytics(date,date,text,boolean) from public,anon;
grant execute on function public.owner_financial_analytics(date,date,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
