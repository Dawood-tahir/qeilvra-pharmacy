begin;

create or replace function public.owner_dashboard_metrics(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_owner() then raise exception 'Owner permission required' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'Invalid reporting period.'; end if;

  with period_sales as (
    select s.id, s.net_total
    from public.sales s
    where (s.completed_at at time zone 'Asia/Karachi')::date between p_from and p_to
  ), refunds as (
    select sr.sale_id, sum(sr.refund_amount) as amount
    from public.sale_returns sr
    join period_sales ps on ps.id = sr.sale_id
    where sr.status = 'approved'
    group by sr.sale_id
  ), sold_cost as (
    select si.sale_id, sum(sic.quantity * sic.unit_cost) as amount
    from public.sale_items si
    join public.sale_item_costs sic on sic.sale_item_id = si.id
    join period_sales ps on ps.id = si.sale_id
    group by si.sale_id
  ), returned_cost as (
    select si.sale_id,
      sum(coalesce(ri.approved_quantity, 0) * coalesce(unit_costs.avg_cost, 0)) as amount
    from public.return_items ri
    join public.sale_returns sr on sr.id = ri.return_id and sr.status = 'approved'
    join public.sale_items si on si.id = ri.sale_item_id
    join period_sales ps on ps.id = si.sale_id
    left join lateral (
      select sum(sic.quantity * sic.unit_cost) / nullif(sum(sic.quantity), 0) as avg_cost
      from public.sale_item_costs sic where sic.sale_item_id = si.id
    ) unit_costs on true
    group by si.sale_id
  ), financials as (
    select
      coalesce(sum(ps.net_total - coalesce(r.amount, 0)), 0) as revenue,
      coalesce(sum(coalesce(sc.amount, 0) - coalesce(rc.amount, 0)), 0) as cogs,
      count(*) as sale_count
    from period_sales ps
    left join refunds r on r.sale_id = ps.id
    left join sold_cost sc on sc.sale_id = ps.id
    left join returned_cost rc on rc.sale_id = ps.id
  ), expense_total as (
    select coalesce(sum(e.amount), 0) as amount from public.expenses e
    where e.expense_date between p_from and p_to
  ), inventory as (
    select m.id, m.reorder_level,
      coalesce(sum(b.quantity_on_hand) filter (
        where b.expiry_date >= (now() at time zone 'Asia/Karachi')::date and not b.is_quarantined
      ), 0) as qty
    from public.medicines m
    left join public.medicine_batches b on b.medicine_id = m.id and b.quantity_on_hand > 0
    where m.is_active group by m.id
  )
  select jsonb_build_object(
    'period_from', p_from,
    'period_to', p_to,
    'revenue', round(f.revenue, 2),
    'gross_profit', round(f.revenue - f.cogs, 2),
    'expenses', round(e.amount, 2),
    'net_operating_result', round(f.revenue - f.cogs - e.amount, 2),
    'sales_count', f.sale_count,
    'total_medicines', (select count(*) from public.medicines where is_active),
    'low_stock_items', (select count(*) from inventory where qty > 0 and qty <= reorder_level),
    'out_of_stock_items', (select count(*) from inventory where qty <= 0),
    'expiring_items', (select count(*) from public.medicine_batches b
      where b.quantity_on_hand > 0 and not b.is_quarantined
        and b.expiry_date between (now() at time zone 'Asia/Karachi')::date
          and (now() at time zone 'Asia/Karachi')::date +
            (select expiry_alert_days from public.pharmacy_settings where id = true))
  ) into v_result
  from financials f cross join expense_total e;
  return v_result;
end;
$$;

create or replace function public.owner_sales_trend(p_from date, p_to date)
returns table (sale_date date, revenue numeric, gross_profit numeric, sale_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'Owner permission required' using errcode = '42501'; end if;
  return query
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as day
  ), sale_values as (
    select s.id, (s.completed_at at time zone 'Asia/Karachi')::date as day,
      s.net_total - coalesce((select sum(sr.refund_amount) from public.sale_returns sr
        where sr.sale_id = s.id and sr.status = 'approved'), 0) as net_revenue,
      coalesce((select sum(sic.quantity * sic.unit_cost)
        from public.sale_items si join public.sale_item_costs sic on sic.sale_item_id = si.id
        where si.sale_id = s.id), 0) as cogs,
      coalesce((select sum(ri.approved_quantity * costs.avg_cost)
        from public.return_items ri
        join public.sale_returns sr on sr.id = ri.return_id and sr.status = 'approved'
        join public.sale_items si on si.id = ri.sale_item_id
        join lateral (select coalesce(sum(sic.quantity * sic.unit_cost) / nullif(sum(sic.quantity), 0), 0) avg_cost
          from public.sale_item_costs sic where sic.sale_item_id = si.id) costs on true
        where sr.sale_id = s.id), 0) as returned_cogs
    from public.sales s
    where (s.completed_at at time zone 'Asia/Karachi')::date between p_from and p_to
  )
  select d.day, round(coalesce(sum(sv.net_revenue), 0), 2),
    round(coalesce(sum(sv.net_revenue - sv.cogs + sv.returned_cogs), 0), 2),
    count(sv.id)
  from days d left join sale_values sv on sv.day = d.day
  group by d.day order by d.day;
end;
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
  if public.current_role() <> 'salesperson'::public.app_role then
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

create or replace function public.owner_report_breakdowns(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_owner() then raise exception 'Owner permission required' using errcode = '42501'; end if;
  with period_sales as (
    select * from public.sales s
    where (s.completed_at at time zone 'Asia/Karachi')::date between p_from and p_to
  ), returns_by_item as (
    select ri.sale_item_id, sum(ri.approved_quantity) quantity
    from public.return_items ri join public.sale_returns sr on sr.id = ri.return_id
    join period_sales ps on ps.id = sr.sale_id
    where sr.status = 'approved' group by ri.sale_item_id
  ), medicine_sales as (
    select si.medicine_id, si.medicine_name,
      sum(si.quantity - coalesce(r.quantity, 0)) as quantity,
      sum((si.quantity - coalesce(r.quantity, 0)) * si.unit_price) as revenue
    from public.sale_items si join period_sales ps on ps.id = si.sale_id
    left join returns_by_item r on r.sale_item_id = si.id
    group by si.medicine_id, si.medicine_name order by revenue desc limit 10
  ), salesperson as (
    select p.id, p.full_name, count(ps.id) sales_count,
      coalesce(sum(ps.net_total - coalesce((select sum(sr.refund_amount) from public.sale_returns sr where sr.sale_id = ps.id and sr.status = 'approved'), 0)), 0) revenue
    from public.profiles p join public.user_roles ur on ur.user_id = p.id
    left join period_sales ps on ps.created_by = p.id
    where ur.role in ('owner', 'salesperson') group by p.id, p.full_name order by revenue desc
  )
  select jsonb_build_object(
    'medicine_sales', coalesce((select jsonb_agg(to_jsonb(ms)) from medicine_sales ms), '[]'::jsonb),
    'salesperson_performance', coalesce((select jsonb_agg(to_jsonb(sp)) from salesperson sp), '[]'::jsonb),
    'purchase_total', coalesce((select sum(p.total) from public.purchases p where p.status = 'posted' and p.invoice_date between p_from and p_to), 0),
    'refund_total', coalesce((select sum(sr.refund_amount) from public.sale_returns sr join period_sales ps on ps.id = sr.sale_id where sr.status = 'approved'), 0),
    'return_count', (select count(*) from public.sale_returns sr join period_sales ps on ps.id = sr.sale_id where sr.status = 'approved')
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.inventory_alerts(p_kind text default 'low_stock', p_limit integer default 10)
returns table (
  medicine_id uuid,
  medicine_name text,
  strength text,
  sku text,
  available_quantity numeric,
  reorder_level numeric,
  expiry_date date,
  alert_kind text,
  days_until_expiry integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_expiry_days integer;
begin
  if not public.is_active_staff() then raise exception 'Not authorized' using errcode = '42501'; end if;
  select expiry_alert_days into v_expiry_days from public.pharmacy_settings where id = true;
  return query
  with inventory as (
    select m.id, m.name, m.strength, m.sku, m.reorder_level,
      coalesce(sum(b.quantity_on_hand) filter (where b.expiry_date >= v_today and not b.is_quarantined), 0) qty,
      min(b.expiry_date) filter (where b.quantity_on_hand > 0 and not b.is_quarantined and b.expiry_date >= v_today) next_expiry
    from public.medicines m left join public.medicine_batches b
      on b.medicine_id = m.id and b.quantity_on_hand > 0
    where m.is_active group by m.id
  )
  select i.id, i.name, i.strength, i.sku, i.qty::numeric, i.reorder_level,
    i.next_expiry,
    case when i.qty <= 0 then 'out_of_stock'
      when i.next_expiry <= v_today + v_expiry_days then 'expiring'
      else 'low_stock' end,
    case when i.next_expiry is null then null else i.next_expiry - v_today end
  from inventory i
  where case p_kind
    when 'out_of_stock' then i.qty <= 0
    when 'expiring' then i.qty > 0 and i.next_expiry between v_today and v_today + v_expiry_days
    else i.qty > 0 and i.qty <= i.reorder_level
  end
  order by case when p_kind = 'expiring' then (i.next_expiry - v_today)::numeric else i.qty end, i.name
  limit least(greatest(p_limit, 1), 100);
end;
$$;

create or replace function public.receipt_settings()
returns table (pharmacy_name text, address text, phone text, tax_number text, currency_code text, timezone text, receipt_footer text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_active_staff() then raise exception 'Not authorized' using errcode = '42501'; end if;
  return query select s.pharmacy_name, s.address, s.phone, s.tax_number, s.currency_code, s.timezone, s.receipt_footer
  from public.pharmacy_settings s where s.id = true;
end;
$$;

revoke all on function public.owner_dashboard_metrics(date, date) from public, anon;
revoke all on function public.owner_sales_trend(date, date) from public, anon;
revoke all on function public.salesperson_dashboard() from public, anon;
revoke all on function public.owner_report_breakdowns(date, date) from public, anon;
revoke all on function public.inventory_alerts(text, integer) from public, anon;
revoke all on function public.receipt_settings() from public, anon;
grant execute on function public.owner_dashboard_metrics(date, date) to authenticated;
grant execute on function public.owner_sales_trend(date, date) to authenticated;
grant execute on function public.salesperson_dashboard() to authenticated;
grant execute on function public.owner_report_breakdowns(date, date) to authenticated;
grant execute on function public.inventory_alerts(text, integer) to authenticated;
grant execute on function public.receipt_settings() to authenticated;

commit;
