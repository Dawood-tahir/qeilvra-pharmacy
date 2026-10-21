-- Review and approve before production application. No transaction corrections,
-- stock updates, permission changes, or archive activation are performed here.
begin;
set local lock_timeout='5s';

-- NUMERIC NaN sorts above finite values, so a plain CHECK(value>=0) accepts it.
-- Invalid monetary input must fail atomically even through direct Owner RPCs.
alter table public.purchases add constraint purchases_finite_money check(subtotal::text<>'NaN' and discount::text<>'NaN' and total::text<>'NaN');
alter table public.purchase_items add constraint purchase_items_finite_cost check(unit_cost::text not in ('NaN','Infinity','-Infinity'));
alter table public.medicine_batches add constraint medicine_batches_finite_cost check(purchase_cost::text not in ('NaN','Infinity','-Infinity'));
alter table public.sale_item_costs add constraint sale_item_costs_finite_cost check(unit_cost::text not in ('NaN','Infinity','-Infinity'));
alter table public.expenses add constraint expenses_finite_amount check(amount::text<>'NaN');

-- Receiving and sale-cost allocations retain unconstrained NUMERIC batch costs.
-- Disposals must retain that same cost, rounding only the reported total.
-- Existing rounded snapshots are preserved; their lost precision is not guessed.
-- PostgreSQL requires recreating this generated column before changing its
-- input type. Recompute from the unchanged saved quantity and saved unit cost.
alter table public.stock_dispositions drop column cost_value;
alter table public.stock_dispositions alter column unit_cost type numeric;
alter table public.stock_dispositions add column cost_value numeric generated always as (quantity*unit_cost) stored;
alter table public.stock_dispositions drop constraint stock_dispositions_unit_cost_check;
alter table public.stock_dispositions add constraint stock_dispositions_unit_cost_check
 check(unit_cost>=0 and unit_cost::text not in ('NaN','Infinity','-Infinity'));

-- Keep the current posting implementation, locks and valuation formula. The
-- NUMERIC(12,3) quantity variable cannot hold valid NUMERIC(14,2) receipt totals.
do $$
declare v_definition text:=pg_get_functiondef('public.post_purchase(uuid)'::regprocedure);
begin
 if position('v_after numeric(12,3);' in v_definition)=0
 or position('select round(sum(pi.quantity * pi.unit_cost), 2) into v_after' in v_definition)=0
 or position('set subtotal = v_after, total = v_after - v_purchase.discount' in v_definition)=0 then
   raise exception 'Purchase posting implementation changed; review financial accuracy migration.';
 end if;
 v_definition:=replace(v_definition,'v_after numeric(12,3);','v_after numeric(12,3); v_subtotal numeric;');
 v_definition:=replace(v_definition,'select round(sum(pi.quantity * pi.unit_cost), 2) into v_after','select round(sum(pi.quantity * pi.unit_cost), 2) into v_subtotal');
 v_definition:=replace(v_definition,'if v_purchase.discount > v_after','if v_purchase.discount > v_subtotal');
 v_definition:=replace(v_definition,'set subtotal = v_after, total = v_after - v_purchase.discount','set subtotal = v_subtotal, total = v_subtotal - v_purchase.discount');
 -- Use the posted header's actual totals for the existing proportional discount
 -- allocation, even when an Owner edited a draft before posting.
 v_definition:=regexp_replace(v_definition,'where id = p_purchase_id;(\s+if exists)',
   'where id = p_purchase_id returning * into v_purchase;\1');
 if position('returning * into v_purchase' in v_definition)=0 then
   raise exception 'Purchase posting update changed; review financial accuracy migration.';
 end if;
 execute v_definition;
end $$;

-- A real zero cost is valid. Missing allocation rows are not evidence of a
-- zero cost: stop the report instead of silently overstating gross profit.
do $$
declare v_definition text:=pg_get_functiondef('private.sales_financial_analytics(date,date,text,boolean)'::regprocedure);
 v_marker text:=' with period_sales as materialized (';
 v_guard text:=$guard$
 if exists(
   select 1 from public.invoice_item_rows i join public.sales s on s.id=i.sale_id
   left join lateral(select count(*) allocations,sum(c.quantity) quantity from public.sale_item_costs c where c.sale_item_id=i.id) c on true
   where ((s.completed_at>=v_start and s.completed_at<v_end) or exists(
     select 1 from public.sale_returns r where r.sale_id=s.id and r.status='approved' and r.reviewed_at>=v_start and r.reviewed_at<v_end))
   and (c.allocations=0 or c.quantity is distinct from coalesce(i.base_quantity,i.quantity*coalesce(i.base_units_per_sale_unit,1)))
 ) then raise exception 'Invoice cost allocations are incomplete. Review the original transactions before using financial reports.'; end if;
$guard$;
begin
 if position(v_marker in v_definition)=0 then raise exception 'Financial analytics implementation changed; review cost integrity guard.'; end if;
 -- Financial fixes can also be reviewed independently of archive deployment.
 if to_regclass('public.invoice_item_rows') is null then
   v_guard:=replace(v_guard,'public.invoice_item_rows','public.sale_items');
 end if;
 execute replace(v_definition,v_marker,v_guard||v_marker);
end $$;
notify pgrst,'reload schema';
commit;
