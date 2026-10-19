-- Measured query improvements; no transaction, stock, price or profit formulas change.
begin;
-- Foreign-key lookups inside COGS/refund and return-history queries previously scanned these tables.
create index if not exists sale_item_costs_line_idx on public.sale_item_costs(sale_item_id);
create index if not exists return_items_return_idx on public.return_items(return_id);
create index if not exists return_items_sale_line_idx on public.return_items(sale_item_id);

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
    where s.completed_at >= (p_from::timestamp at time zone 'Asia/Karachi') and s.completed_at < ((p_to+1)::timestamp at time zone 'Asia/Karachi')
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
      sum(case when si.selling_unit is null or coalesce(ri.restockable,false) then coalesce(
      (select sum(ra.base_quantity*ra.unit_cost) from public.return_allocations ra where ra.return_item_id=ri.id),
      coalesce(ri.approved_quantity,0)*coalesce(si.base_units_per_sale_unit,1)*coalesce(unit_costs.avg_cost,0)) else 0 end) as amount
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
      coalesce((select sum(case when si.selling_unit is null or coalesce(ri.restockable,false) then coalesce(
      (select sum(ra.base_quantity*ra.unit_cost) from public.return_allocations ra where ra.return_item_id=ri.id),
      ri.approved_quantity*coalesce(si.base_units_per_sale_unit,1)*costs.avg_cost) else 0 end)
        from public.return_items ri
        join public.sale_returns sr on sr.id = ri.return_id and sr.status = 'approved'
        join public.sale_items si on si.id = ri.sale_item_id
        join lateral (select coalesce(sum(sic.quantity * sic.unit_cost) / nullif(sum(sic.quantity), 0), 0) avg_cost
          from public.sale_item_costs sic where sic.sale_item_id = si.id) costs on true
        where sr.sale_id = s.id), 0) as returned_cogs
    from public.sales s
    where s.completed_at >= (p_from::timestamp at time zone 'Asia/Karachi') and s.completed_at < ((p_to+1)::timestamp at time zone 'Asia/Karachi')
  )
  select d.day, round(coalesce(sum(sv.net_revenue), 0), 2),
    round(coalesce(sum(sv.net_revenue - sv.cogs + sv.returned_cogs), 0), 2),
    count(sv.id)
  from days d left join sale_values sv on sv.day = d.day
  group by d.day order by d.day;
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
    where s.completed_at >= (p_from::timestamp at time zone 'Asia/Karachi') and s.completed_at < ((p_to+1)::timestamp at time zone 'Asia/Karachi')
  ), returns_by_item as (
    select ri.sale_item_id, sum(ri.approved_quantity) quantity
    from public.return_items ri join public.sale_returns sr on sr.id = ri.return_id
    join period_sales ps on ps.id = sr.sale_id
    where sr.status = 'approved' group by ri.sale_item_id
  ), medicine_sales as (
    select si.medicine_id, si.medicine_name,
      sum((si.quantity - coalesce(r.quantity, 0))*coalesce(si.base_units_per_sale_unit,1)) as quantity,
      sum((si.quantity - coalesce(r.quantity, 0)) * coalesce(si.net_line_total / si.quantity, si.unit_price * case when ps.subtotal>0 then ps.net_total/ps.subtotal else 0 end)) as revenue
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

create or replace function private.inventory_search(p_query text,p_limit integer,p_offset integer,p_filter text,p_sort text)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_owner boolean:=public.is_owner();
 v_today date:=(now() at time zone 'Asia/Karachi')::date;
 v_days integer;
begin
 if public.is_active_staff() is distinct from true then raise exception 'Not authorized' using errcode='42501'; end if;
 select expiry_alert_days into v_days from public.pharmacy_settings where id;
 -- For name-sorted unfiltered/review lists, select this page before stock/unit aggregation.
 if coalesce(p_filter,'all') not in ('low_stock','expiring') and coalesce(p_sort,'name') not in ('stock','expiry') then
  return query
  with page as materialized (
   select m.* from public.medicines m
   where (m.is_active or v_owner) and (p_filter is distinct from 'review' or m.packaging_status='needs_review')
    and (coalesce(trim(p_query),'')='' or m.barcode=trim(p_query) or m.sku ilike trim(p_query)||'%'
     or m.name ilike '%'||trim(p_query)||'%' or m.generic_name ilike '%'||trim(p_query)||'%')
   order by case when m.barcode=trim(p_query) then 0 when m.sku=trim(p_query) then 1 else 2 end,m.name,m.id
   limit least(greatest(p_limit,1),50) offset greatest(p_offset,0)
  )
  select (to_jsonb(m)-'created_by')||jsonb_build_object(
   'available_quantity',coalesce(b.qty,0),'nearest_expiry',b.expiry,
   'stock_status',case when coalesce(b.qty,0)<=0 then 'out_of_stock' when b.qty<=m.reorder_level then 'low_stock' else 'in_stock' end,
   'expiring_soon',coalesce(b.expiry<=v_today+v_days,false),
   'units',coalesce((select jsonb_agg(to_jsonb(u)-'medicine_id' order by u.base_quantity) from public.medicine_units u where u.medicine_id=m.id),'[]'::jsonb))
  from page m left join lateral (
   select sum(mb.quantity_on_hand) qty,min(mb.expiry_date) expiry from public.medicine_batches mb
   where mb.medicine_id=m.id and mb.quantity_on_hand>0 and not mb.is_quarantined and mb.expiry_date>=v_today
  )b on true
  order by case when m.barcode=trim(p_query) then 0 when m.sku=trim(p_query) then 1 else 2 end,m.name,m.id;
  return;
 end if;
 return query
 with stock as materialized (
  select m.*,coalesce(b.qty,0) available_quantity,b.expiry nearest_expiry,
   case when coalesce(b.qty,0)<=0 then 'out_of_stock' when b.qty<=m.reorder_level then 'low_stock' else 'in_stock' end stock_status
  from public.medicines m left join lateral (
   select sum(mb.quantity_on_hand) qty,min(mb.expiry_date) expiry from public.medicine_batches mb
   where mb.medicine_id=m.id and mb.quantity_on_hand>0 and not mb.is_quarantined and mb.expiry_date>=v_today
  )b on true
  where (m.is_active or v_owner) and (coalesce(trim(p_query),'')='' or m.barcode=trim(p_query) or m.sku ilike trim(p_query)||'%'
   or m.name ilike '%'||trim(p_query)||'%' or m.generic_name ilike '%'||trim(p_query)||'%')
 ), page as materialized (
  select s.* from stock s where case p_filter
   when 'low_stock' then s.available_quantity<=s.reorder_level
   when 'expiring' then s.nearest_expiry<=v_today+v_days
   when 'review' then s.packaging_status='needs_review' else true end
  order by case when s.barcode=trim(p_query) then 0 when s.sku=trim(p_query) then 1 else 2 end,
   case when p_sort='stock' then s.available_quantity end,
   case when p_sort='expiry' then s.nearest_expiry end nulls last,s.name,s.id
  limit least(greatest(p_limit,1),50) offset greatest(p_offset,0)
 )
 select (to_jsonb(s)-'created_by')||jsonb_build_object('expiring_soon',coalesce(s.nearest_expiry<=v_today+v_days,false),
  'units',coalesce((select jsonb_agg(to_jsonb(u)-'medicine_id' order by u.base_quantity) from public.medicine_units u where u.medicine_id=s.id),'[]'::jsonb))
 from page s order by case when s.barcode=trim(p_query) then 0 when s.sku=trim(p_query) then 1 else 2 end,
  case when p_sort='stock' then s.available_quantity end,
  case when p_sort='expiry' then s.nearest_expiry end nulls last,s.name,s.id;
end $$;
-- The expense list is paged, but its selected-period total must cover every row.
create or replace function public.owner_expense_total(p_from date,p_to date)
returns numeric language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_owner() then raise exception 'Owner permission required' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from>p_to then raise exception 'Invalid reporting period.'; end if;
 return (select coalesce(sum(amount),0) from public.expenses where expense_date between p_from and p_to);
end $$;
revoke all on function public.owner_expense_total(date,date) from public,anon;
grant execute on function public.owner_expense_total(date,date) to authenticated;
commit;
