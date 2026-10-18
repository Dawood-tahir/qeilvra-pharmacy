begin;

create or replace function public.post_purchase(p_purchase_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases%rowtype;
  v_item record;
  v_batch_id uuid;
  v_after numeric(12,3);
begin
  if not public.is_owner() then
    raise exception 'Owner permission required' using errcode = '42501';
  end if;
  select * into v_purchase from public.purchases where id = p_purchase_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  if v_purchase.status <> 'draft' then raise exception 'Only draft purchases can be posted.'; end if;
  if not exists (select 1 from public.purchase_items where purchase_id = p_purchase_id) then
    raise exception 'Add at least one purchase item before posting.';
  end if;
  if exists (select 1 from public.purchase_items where purchase_id = p_purchase_id
    and expiry_date <= (now() at time zone 'Asia/Karachi')::date) then
    raise exception 'Expired stock cannot be received.';
  end if;

  select round(sum(pi.quantity * pi.unit_cost), 2) into v_after
  from public.purchase_items pi where pi.purchase_id = p_purchase_id;
  if v_purchase.discount > v_after then raise exception 'Purchase discount exceeds its subtotal.'; end if;
  update public.purchases set subtotal = v_after, total = v_after - v_purchase.discount
  where id = p_purchase_id;

  if exists(select 1 from public.purchase_items pi join public.medicines m on m.id=pi.medicine_id
    where pi.purchase_id=p_purchase_id and (m.packaging_status<>'confirmed' or pi.quantity<>trunc(pi.quantity))) then
    raise exception 'Confirm packaging and whole-item counts before posting stock.';
  end if;
  for v_item in select * from public.purchase_items where purchase_id = p_purchase_id order by id
  loop
    insert into public.medicine_batches(
      medicine_id, supplier_id, purchase_item_id, batch_number, expiry_date,
      quantity_on_hand, purchase_cost
    ) values (
      v_item.medicine_id, v_purchase.supplier_id, v_item.id, v_item.batch_number,
      v_item.expiry_date, v_item.quantity, v_item.unit_cost * case when v_purchase.subtotal > 0 then v_purchase.total/v_purchase.subtotal else 1 end
    )
    returning id, quantity_on_hand into v_batch_id, v_after;

    insert into public.stock_movements(
      medicine_id, batch_id, kind, quantity_delta, quantity_after,
      reference_type, reference_id, performed_by
    ) values (
      v_item.medicine_id, v_batch_id, 'purchase', v_item.quantity, v_after,
      'purchase', p_purchase_id, auth.uid()
    );
  end loop;

  update public.purchases set status = 'posted', posted_at = now() where id = p_purchase_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_data)
  values (auth.uid(), 'post', 'purchases', p_purchase_id::text, to_jsonb(v_purchase));
  return p_purchase_id;
end;
$$;

create or replace function private.review_sale_return(
  p_return_id uuid,
  p_approve boolean,
  p_items jsonb default '[]'::jsonb,
  p_review_notes text default null,
  p_payment_method public.payment_method default 'cash'
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.sale_returns%rowtype;
  v_sale public.sales%rowtype;
  v_refund numeric(14,2) := 0;
  v_item record;
  v_return_item public.return_items%rowtype;
  v_sale_item public.sale_items%rowtype;
  v_allocation record;
  v_remaining numeric(12,3);
  v_take numeric(12,3);
  v_after numeric(12,3);
  v_previously_approved numeric(12,3);
  v_allocated numeric;
  v_target_refund numeric;
  v_previous_refund numeric;
  v_returned_count numeric;
  v_line_total numeric;
  v_mid uuid;
begin
  if not public.is_owner() then raise exception 'Owner permission required' using errcode = '42501'; end if;
  if p_approve is null or p_payment_method is null then raise exception 'Check the return decision and payment method.'; end if;
  if p_approve and (jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0) then raise exception 'Select at least one item.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(return_item_id uuid) group by x.return_item_id having count(*)>1) then
    raise exception 'Each return item can be reviewed only once.';
  end if;
  select * into v_return from public.sale_returns where id = p_return_id for update;
  if not found then raise exception 'Return request not found.'; end if;
  if v_return.status <> 'requested' then raise exception 'This return has already been reviewed.'; end if;
  select * into v_sale from public.sales where id = v_return.sale_id for update;

  if not p_approve then
    update public.sale_returns set status = 'rejected', reviewed_by = auth.uid(),
      reviewed_at = now(), review_notes = nullif(trim(p_review_notes), '') where id = p_return_id;
    return 0;
  end if;

  -- Serialize all affected medicine/batch changes in the same order as checkout.
  for v_mid in select distinct si.medicine_id from public.return_items ri join public.sale_items si on si.id=ri.sale_item_id
    where ri.return_id=p_return_id order by si.medicine_id loop
    perform 1 from public.medicines where id=v_mid for update;
    perform 1 from public.medicine_batches b where b.medicine_id=v_mid order by b.expiry_date,b.created_at,b.id for update;
  end loop;
  for v_item in select * from jsonb_to_recordset(p_items)
    as x(return_item_id uuid, approved_quantity numeric, restockable boolean)
  loop
    select * into v_return_item from public.return_items
      where id = v_item.return_item_id and return_id = p_return_id for update;
    if not found or v_item.approved_quantity is null or v_item.approved_quantity < 0 or v_item.approved_quantity > v_return_item.quantity then
      raise exception 'Invalid approved return quantity.';
    end if;
    select * into v_sale_item from public.sale_items where id = v_return_item.sale_item_id for update;
    select coalesce(sum(ri.approved_quantity), 0) into v_previously_approved
      from public.return_items ri join public.sale_returns sr on sr.id = ri.return_id
      where ri.sale_item_id = v_sale_item.id and sr.status = 'approved';
    if v_previously_approved + v_item.approved_quantity > v_sale_item.quantity then
      raise exception 'Approved returns exceed the quantity sold for %.', v_sale_item.medicine_name;
    end if;
    if v_sale_item.selling_unit is not null and v_item.approved_quantity<>trunc(v_item.approved_quantity) then raise exception 'Return whole selling units.'; end if;
    -- Use cumulative rounding so multiple partial refunds cannot exceed the original line payment.
    v_target_refund:=round((v_previously_approved+v_item.approved_quantity)*coalesce(v_sale_item.net_line_total/v_sale_item.quantity,
      v_sale_item.unit_price*case when v_sale.subtotal>0 then v_sale.net_total/v_sale.subtotal else 0 end),2);
    v_previous_refund:=round(v_previously_approved*coalesce(v_sale_item.net_line_total/v_sale_item.quantity,
      v_sale_item.unit_price*case when v_sale.subtotal>0 then v_sale.net_total/v_sale.subtotal else 0 end),2);
    v_refund:=v_refund+v_target_refund-v_previous_refund;
    update public.return_items set approved_quantity = v_item.approved_quantity,
      restockable = coalesce(v_item.restockable, false) where id = v_return_item.id;


    v_remaining:=v_item.approved_quantity*coalesce(v_sale_item.base_units_per_sale_unit,1);
    for v_allocation in select sic.*,b.expiry_date,b.is_quarantined from public.sale_item_costs sic
      join public.medicine_batches b on b.id=sic.batch_id where sic.sale_item_id=v_sale_item.id
      order by b.expiry_date,b.created_at,b.id,sic.id for update of sic loop
      exit when v_remaining<=0;
      select coalesce(sum(ra.base_quantity),0) into v_allocated from public.return_allocations ra where ra.sale_item_cost_id=v_allocation.id;
      -- For historical returns before this migration, skip allocations conservatively in FEFO order.
      if v_sale_item.selling_unit is null then
        select coalesce(sum(ri.approved_quantity),0) into v_returned_count from public.return_items ri
          join public.sale_returns sr on sr.id=ri.return_id where ri.sale_item_id=v_sale_item.id and sr.status='approved'
          and not exists(select 1 from public.return_allocations ra where ra.return_item_id=ri.id);
        select coalesce(sum(sic.quantity),0) into v_line_total from public.sale_item_costs sic join public.medicine_batches b on b.id=sic.batch_id
          where sic.sale_item_id=v_sale_item.id and (b.expiry_date,b.created_at,b.id,sic.id) <
            (v_allocation.expiry_date,(select created_at from public.medicine_batches where id=v_allocation.batch_id),v_allocation.batch_id,v_allocation.id);
        v_allocated:=v_allocated+least(v_allocation.quantity,greatest(v_returned_count-v_line_total,0));
      end if;
      v_take:=least(v_remaining,greatest(v_allocation.quantity-v_allocated,0));
      if v_take<=0 then continue; end if;
      if coalesce(v_item.restockable,false) and (v_allocation.is_quarantined or v_allocation.expiry_date<(now() at time zone 'Asia/Karachi')::date) then
        raise exception 'Expired or quarantined returned medicine cannot be added to sellable stock.';
      end if;
      insert into public.return_allocations values(v_return_item.id,v_allocation.id,v_take,v_allocation.unit_cost);
      if coalesce(v_item.restockable,false) then
        update public.medicine_batches set quantity_on_hand=quantity_on_hand+v_take where id=v_allocation.batch_id returning quantity_on_hand into v_after;
        insert into public.stock_movements(medicine_id,batch_id,kind,quantity_delta,quantity_after,reference_type,reference_id,reason,performed_by)
        values(v_sale_item.medicine_id,v_allocation.batch_id,'return_restock',v_take,v_after,'sale_return',p_return_id,v_return.reason,auth.uid());
      else
        insert into public.stock_movements(medicine_id,batch_id,kind,quantity_delta,quantity_after,reference_type,reference_id,reason,metadata,performed_by)
        values(v_sale_item.medicine_id,v_allocation.batch_id,'return_non_sellable',0,null,'sale_return',p_return_id,v_return.reason,
          jsonb_build_object('non_sellable_quantity',v_take),auth.uid());
      end if;
      v_remaining:=v_remaining-v_take;
    end loop;
    if v_remaining>0 then raise exception 'Returned quantity exceeds its original batch allocations. Owner review is required.'; end if;
  end loop;

  if not exists(select 1 from public.return_items where return_id=p_return_id and approved_quantity>0) then raise exception 'Approve at least one returned unit.'; end if;
  update public.sale_returns set status = 'approved', refund_amount = v_refund,
    reviewed_by = auth.uid(), reviewed_at = now(), review_notes = nullif(trim(p_review_notes), '')
    where id = p_return_id;
  if v_refund>0 then
  insert into public.payments(sale_id, return_id, kind, method, amount, tendered_amount, change_amount, received_by)
  values (v_return.sale_id, p_return_id, 'refund', p_payment_method, v_refund,
    case when p_payment_method = 'cash' then v_refund else null end, 0, auth.uid());
  end if;

  if (select coalesce(sum(refund_amount),0) from public.sale_returns where sale_id=v_return.sale_id and status='approved')>v_sale.net_total then
    raise exception 'Refunds cannot exceed the amount paid.';
  end if;
  update public.sales s set status = case
    when (select coalesce(sum(sr.refund_amount), 0) from public.sale_returns sr
      where sr.sale_id = s.id and sr.status = 'approved') >= s.net_total then 'refunded'::public.sale_status
    else 'partially_refunded'::public.sale_status end
    where s.id = v_return.sale_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_data)
  values (auth.uid(), 'approve_refund', 'sale_returns', p_return_id::text,
    jsonb_build_object('refund_amount', v_refund));
  return v_refund;
end;
$$;

create or replace function public.review_sale_return(p_return_id uuid,p_approve boolean,p_items jsonb default '[]'::jsonb,p_review_notes text default null,p_payment_method public.payment_method default 'cash')
returns numeric language sql security invoker set search_path='' as $$ select private.review_sale_return(p_return_id,p_approve,p_items,p_review_notes,p_payment_method) $$;
revoke all on function private.review_sale_return(uuid,boolean,jsonb,text,public.payment_method) from public,anon;
grant execute on function private.review_sale_return(uuid,boolean,jsonb,text,public.payment_method) to authenticated;
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
commit;
