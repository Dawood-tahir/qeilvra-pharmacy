begin;

-- Expose date summaries for visible Inventory medicines without exposing the batch table.
create function public.inventory_batch_expiries(p_medicine_ids uuid[])
returns table (medicine_id uuid, earliest_expired date, nearest_unexpired date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_manage boolean := public.can_manage_operations();
begin
  if public.is_active_staff() is distinct from true then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if cardinality(p_medicine_ids) > 100 then
    raise exception 'At most 100 medicines can be requested at once' using errcode = '22023';
  end if;

  return query
  select b.medicine_id,
         min(b.expiry_date) filter (where b.expiry_date < v_today),
         min(b.expiry_date) filter (where b.expiry_date >= v_today)
  from public.medicine_batches b
  join public.medicines m on m.id = b.medicine_id
  where b.medicine_id = any(p_medicine_ids) and (m.is_active or v_manage)
  group by b.medicine_id;
end;
$$;

revoke all on function public.inventory_batch_expiries(uuid[]) from public, anon;
grant execute on function public.inventory_batch_expiries(uuid[]) to authenticated;

commit;
