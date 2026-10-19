-- Read-only analytics on existing transactions. Requires deployment approval.
-- No financial rows, transaction functions, table permissions or RLS policies change.
begin;
create index if not exists sale_returns_approved_date_idx on public.sale_returns(reviewed_at,sale_id) where status='approved';

create function public.owner_financial_analytics(p_from date,p_to date,p_granularity text default 'day',p_include_inventory boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_today date:=(now() at time zone 'Asia/Karachi')::date;
 v_start timestamptz; v_end timestamptz; v_result jsonb; v_inventory jsonb;
begin
 if public.is_owner() is distinct from true then raise exception 'Owner permission required' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to>v_today or p_to-p_from>365 or p_granularity is null or p_granularity not in ('hour','day') or (p_granularity='hour' and p_from<>p_to) then
   raise exception 'Choose valid report dates, up to one year, ending today or earlier.';
 end if;
 v_start:=p_from::timestamp at time zone 'Asia/Karachi';
 -- Include records stamped at this transaction's current timestamp, including
 -- immediate reads following a sale/refund in the same transaction.
 v_end:=least((p_to+1)::timestamp at time zone 'Asia/Karachi',now()+interval '1 microsecond');
 with period_sales as materialized (
   select s.* from public.sales s where s.completed_at>=v_start and s.completed_at<v_end
     and s.status in ('completed','partially_refunded','refunded')
 ), sold_cost as (
   select si.sale_id,sum(sic.quantity*sic.unit_cost) amount from period_sales s
   join public.sale_items si on si.sale_id=s.id join public.sale_item_costs sic on sic.sale_item_id=si.id group by si.sale_id
 ), period_returns as materialized (
   select sr.* from public.sale_returns sr where sr.status='approved' and sr.reviewed_at>=v_start and sr.reviewed_at<v_end
 ), returned_items as materialized (
   select ri.*,si.medicine_id,si.medicine_name,coalesce(si.base_units_per_sale_unit,1) factor,
     coalesce(ri.approved_base_quantity,ri.approved_quantity*coalesce(si.base_units_per_sale_unit,1)) returned_quantity,
     coalesce(alloc.amount,coalesce(ri.approved_base_quantity,ri.approved_quantity*coalesce(si.base_units_per_sale_unit,1))*costs.avg_cost,0) restored_cost,
     alloc.amount is null and coalesce(ri.restockable,false) and coalesce(ri.approved_quantity,0)>0 estimated
   from period_returns sr join public.return_items ri on ri.return_id=sr.id join public.sale_items si on si.id=ri.sale_item_id
   left join lateral(select sum(ra.base_quantity*ra.unit_cost) amount from public.return_allocations ra where ra.return_item_id=ri.id) alloc on true
   left join lateral(select sum(sic.quantity*sic.unit_cost)/nullif(sum(sic.quantity),0) avg_cost from public.sale_item_costs sic where sic.sale_item_id=si.id and alloc.amount is null) costs on true
 ), returned_cost as (
   select return_id,sum(case when restockable is true then restored_cost else 0 end) amount from returned_items group by return_id
 ), events as materialized (
   select s.completed_at at time zone 'Asia/Karachi' local_time,s.subtotal gross_sales,s.discount discounts,0::numeric refunds,
     s.extra_charge_amount extras,s.net_total revenue,coalesce(c.amount,0) cogs,1::bigint sales_count,s.created_by cashier_id
   from period_sales s left join sold_cost c on c.sale_id=s.id
   union all
   select sr.reviewed_at at time zone 'Asia/Karachi',0,0,sr.refund_amount,0,-sr.refund_amount,-coalesce(c.amount,0),0,s.created_by
   from period_returns sr join public.sales s on s.id=sr.sale_id left join returned_cost c on c.return_id=sr.id
 ), period_expenses as materialized (
   select e.expense_date,e.amount,coalesce(ec.name,'Uncategorized') category from public.expenses e
   left join public.expense_categories ec on ec.id=e.category_id where e.expense_date between p_from and p_to
 ), day_values as (
   select local_time::date as bucket_day,sum(gross_sales) gross_sales,sum(discounts) discounts,sum(refunds) refunds,sum(extras) extras,
     sum(revenue) revenue,
     round(sum(sum(cogs)) over(order by local_time::date),2)-round(coalesce(sum(sum(cogs)) over(order by local_time::date rows between unbounded preceding and 1 preceding),0),2) cogs,
     sum(sales_count) sales_count from events group by local_time::date
 ), day_expenses as (
   select expense_date as bucket_day,sum(amount) amount from period_expenses group by expense_date
 ), daily as materialized (
   select d.bucket_day::date sale_date,d.bucket_day at time zone 'Asia/Karachi' bucket_start,
     coalesce(v.sales_count,0) sales_count,round(coalesce(v.gross_sales,0),2) gross_sales,round(coalesce(v.discounts,0),2) discounts,
     round(coalesce(v.refunds,0),2) refunds,round(coalesce(v.extras,0),2) extra_charge_revenue,
     round(coalesce(v.gross_sales-v.discounts-v.refunds,0),2) medicine_revenue,round(coalesce(v.revenue,0),2) revenue,
     round(coalesce(v.cogs,0),2) cogs,round(coalesce(v.revenue-v.cogs,0),2) gross_profit,
     round(coalesce(e.amount,0),2) expenses,round(coalesce(v.revenue-v.cogs,0)-coalesce(e.amount,0),2) net_operating_profit
   from generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d(bucket_day)
   left join day_values v on v.bucket_day=d.bucket_day::date left join day_expenses e on e.bucket_day=d.bucket_day::date
 ), hour_values as (
   select date_trunc('hour',local_time) as bucket_hour,sum(revenue) revenue,
     round(sum(sum(cogs)) over(order by date_trunc('hour',local_time)),2)-round(coalesce(sum(sum(cogs)) over(order by date_trunc('hour',local_time) rows between unbounded preceding and 1 preceding),0),2) cogs,
     sum(sales_count) sales_count,
     sum(gross_sales) gross_sales,sum(discounts) discounts,sum(refunds) refunds,sum(extras) extras from events group by 1
 ), hourly as (
   select h.bucket_hour at time zone 'Asia/Karachi' bucket_start,h.bucket_hour::date sale_date,
     coalesce(v.sales_count,0) sales_count,round(coalesce(v.revenue,0),2) revenue,round(coalesce(v.revenue-v.cogs,0),2) gross_profit,
     round(coalesce(v.cogs,0),2) cogs,round(coalesce(v.gross_sales,0),2) gross_sales,round(coalesce(v.discounts,0),2) discounts,
     round(coalesce(v.refunds,0),2) refunds,round(coalesce(v.extras,0),2) extra_charge_revenue,
     round(coalesce(v.gross_sales-v.discounts-v.refunds,0),2) medicine_revenue,null::numeric expenses,null::numeric net_operating_profit
   from generate_series(p_from::timestamp,
     case when p_to=v_today then date_trunc('hour',now() at time zone 'Asia/Karachi') else p_to::timestamp+interval '23 hours' end,
     interval '1 hour') h(bucket_hour) left join hour_values v on v.bucket_hour=h.bucket_hour where p_granularity='hour'
 ), medicine_quantities as (
   select si.medicine_id,si.medicine_name,sum(si.quantity*coalesce(si.base_units_per_sale_unit,1)) quantity
   from period_sales s join public.sale_items si on si.sale_id=s.id group by si.medicine_id,si.medicine_name
   union all select medicine_id,medicine_name,-sum(returned_quantity) from returned_items group by medicine_id,medicine_name
 ), best_medicines as (
   select q.medicine_id,max(q.medicine_name) medicine_name,sum(q.quantity) quantity,m.base_unit
   from medicine_quantities q join public.medicines m on m.id=q.medicine_id group by q.medicine_id,m.base_unit having sum(q.quantity)>0 order by sum(q.quantity) desc,q.medicine_id limit 8
 ), categories as (
   select category,round(sum(amount),2) amount from period_expenses group by category order by sum(amount) desc,category
 ), salespeople as (
   select p.id,p.full_name,sum(e.sales_count) sales_count,round(sum(e.revenue),2) revenue
   from events e join public.profiles p on p.id=e.cashier_id group by p.id,p.full_name order by sum(e.revenue) desc,p.id
 ), totals as (
   select sum(sales_count) sales_count,sum(gross_sales) gross_sales,sum(discounts) discounts,sum(refunds) refunds,
     sum(medicine_revenue) medicine_revenue,sum(extra_charge_revenue) extra_charge_revenue,sum(revenue) revenue,
     sum(cogs) cogs,sum(gross_profit) gross_profit,sum(expenses) expenses,sum(net_operating_profit) net_operating_profit from daily
 )
 select jsonb_build_object('from',p_from,'to',p_to,'granularity',p_granularity,'generated_at',now(),'metrics',(select to_jsonb(t) from totals t),
   'trend',case when p_granularity='hour' then (select coalesce(jsonb_agg(to_jsonb(h) order by bucket_start),'[]') from hourly h)
     else (select coalesce(jsonb_agg(to_jsonb(d) order by bucket_start),'[]') from daily d) end,
   'daily',(select coalesce(jsonb_agg(to_jsonb(d) order by bucket_start),'[]') from daily d),
   'medicines',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from best_medicines m),
   'expense_categories',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from categories c),
   'salespeople',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from salespeople p),
   'purchases_total',(select coalesce(sum(p.total),0) from public.purchases p where p.status='posted' and p.invoice_date between p_from and p_to),
   'legacy_cost_estimates',(select count(*) from returned_items where estimated)) into v_result;
 if p_include_inventory then
   with inventory as (
     select m.id,m.reorder_level,coalesce(sum(b.quantity_on_hand) filter(where b.expiry_date>=v_today and not b.is_quarantined),0) qty
     from public.medicines m left join public.medicine_batches b on b.medicine_id=m.id and b.quantity_on_hand>0 where m.is_active group by m.id
   ) select jsonb_build_object('total_medicines',count(*),'low_stock_items',count(*) filter(where qty>0 and qty<=reorder_level),'out_of_stock_items',count(*) filter(where qty<=0)) into v_inventory from inventory;
   v_result:=v_result||jsonb_build_object('inventory',v_inventory);
 end if;
 return v_result;
end $$;
revoke all on function public.owner_financial_analytics(date,date,text,boolean) from public,anon;
grant execute on function public.owner_financial_analytics(date,date,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
