-- Local audit remediation. Active Owner/Salesperson permissions are unchanged.
-- Requires deployment approval; never run audit attacks against the hosted database.
begin;
create or replace function public.is_active_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_role() in ('owner'::public.app_role,'salesperson'::public.app_role),false)
$$;

create or replace function public.salesperson_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_result jsonb;
begin
  if public.current_role() is distinct from 'salesperson'::public.app_role then
    raise exception 'Salesperson permission required' using errcode = '42501';
  end if;
  with inventory as (
    select m.id, m.reorder_level,
      coalesce(sum(b.quantity_on_hand) filter (
        where b.expiry_date >= v_today and not b.is_quarantined
      ), 0) qty
    from public.medicines m left join public.medicine_batches b
      on b.medicine_id = m.id and b.quantity_on_hand > 0
    where m.is_active group by m.id
  ), mine as (
    select s.id, s.net_total - coalesce((select sum(sr.refund_amount)
      from public.sale_returns sr where sr.sale_id = s.id and sr.status = 'approved'), 0) net
    from public.sales s where s.created_by = auth.uid()
      and (s.completed_at at time zone 'Asia/Karachi')::date = v_today
  )
  select jsonb_build_object(
    'today_sales', coalesce(sum(mine.net), 0),
    'today_transactions', count(mine.id),
    'low_stock_items', (select count(*) from inventory where qty > 0 and qty <= reorder_level),
    'out_of_stock_items', (select count(*) from inventory where qty <= 0)
  ) into v_result from mine;
  return v_result;
end;
$$;

alter policy returns_read_authorized on public.sale_returns
 using (public.is_active_staff() and (public.is_owner() or requested_by=auth.uid()));
alter policy notifications_mark_read on public.notifications
 using (public.is_active_staff() and (recipient_id=auth.uid() or recipient_role=public.current_role()))
 with check (public.is_active_staff() and (recipient_id=auth.uid() or recipient_role=public.current_role()));
commit;
