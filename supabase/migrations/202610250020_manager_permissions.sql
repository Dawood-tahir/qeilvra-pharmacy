begin;

-- Owner identity stays strict: financial/admin checks never include Manager.
create function public.can_manage_operations()
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.current_role()::text in ('owner','manager'),false)
$$;
revoke all on function public.can_manage_operations() from public,anon;
grant execute on function public.can_manage_operations() to authenticated;

create or replace function public.is_active_staff()
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.current_role()::text in ('owner','manager','salesperson'),false)
$$;

-- Existing table grants and mutation RPCs still apply; only these operational
-- policies are expanded. Cost allocations, financial reports, audit logs, role
-- administration and settings updates retain their Owner-only policies.
alter policy profiles_read_self_or_owner on public.profiles
 using (id=auth.uid() or public.can_manage_operations());
alter policy medicines_staff_read on public.medicines
 using (public.is_active_staff() and (is_active or public.can_manage_operations()));

do $$
declare v_policy record;
begin
 for v_policy in select * from (values
  ('medicine_categories','categories_owner_manage'),
  ('medicines','medicines_owner_manage'),
  ('medicine_costs','medicine_costs_owner_manage'),
  ('suppliers','suppliers_owner_manage'),
  ('purchases','purchases_owner_manage'),
  ('purchase_items','purchase_items_owner_manage'),
  ('expense_categories','expense_categories_owner_manage'),
  ('expenses','expenses_owner_manage')
 ) p(table_name,policy_name) loop
  execute format('alter policy %I on public.%I using (public.can_manage_operations()) with check (public.can_manage_operations())',v_policy.policy_name,v_policy.table_name);
 end loop;
 for v_policy in select * from (values
  ('medicine_batches','batches_owner_read'),
  ('stock_movements','stock_movements_owner_read'),
  ('stock_receipts','receipts_owner_read'),
  ('stock_dispositions','stock_dispositions_owner_read')
 ) p(table_name,policy_name) loop
  execute format('alter policy %I on public.%I using (public.can_manage_operations())',v_policy.policy_name,v_policy.table_name);
 end loop;
end $$;

create policy settings_operations_read on public.pharmacy_settings
 for select to authenticated using (public.can_manage_operations());
alter policy sales_read_authorized on public.sales using (
 public.can_manage_operations() or (public.current_role()='salesperson' and created_by=auth.uid())
);
alter policy sale_items_read_authorized on public.sale_items using (
 exists(select 1 from public.sales s where s.id=sale_id and (public.can_manage_operations() or s.created_by=auth.uid()))
);
alter policy payments_read_authorized on public.payments using (
 exists(select 1 from public.sales s where s.id=sale_id and (public.can_manage_operations() or s.created_by=auth.uid()))
);
alter policy returns_read_authorized on public.sale_returns using (
 public.is_active_staff() and (public.can_manage_operations() or requested_by=auth.uid())
);
alter policy return_items_read_authorized on public.return_items using (
 exists(select 1 from public.sale_returns r where r.id=return_id and (public.can_manage_operations() or r.requested_by=auth.uid()))
);

-- Financial calculations are not rewritten. The allowlist contains operational
-- routines only, retaining their arithmetic, transaction and idempotency logic.
do $$
declare v_function record; v_definition text;
begin
 for v_function in
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prokind='f' and (n.nspname,p.proname) in (
   ('public','save_medicine'),('private','configure_medicine'),
   ('private','save_guided_medicine'),('private','receive_stock'),
   ('public','create_purchase'),('public','post_purchase'),
   ('public','adjust_stock'),('private','correct_stock'),
   ('public','dispose_stock'),('public','confirm_supplier_recovery'),
   ('public','request_sale_return'),('private','review_sale_return'),
   ('private','apply_sale_return'),('private','complete_sale_return'),
   ('public','return_sales'),('private','inventory_search')
  )
 loop
  v_definition:=pg_get_functiondef(v_function.oid);
  if strpos(v_definition,'public.is_owner()')>0 then
   execute replace(v_definition,'public.is_owner()','public.can_manage_operations()');
  end if;
 end loop;
 -- The retained ledger is optional on the current hosted migration level.
 if to_regclass('private.invoice_item_ledger') is not null then
  execute $policy$alter policy invoice_ledger_read on private.invoice_item_ledger using (
   exists(select 1 from public.sales s where s.id=sale_id and (public.can_manage_operations() or s.created_by=auth.uid()))
  )$policy$;
  execute $policy$alter policy invoice_presentation_read on private.invoice_item_presentations using (
   exists(select 1 from private.invoice_item_ledger l join public.sales s on s.id=l.sale_id
    where l.presentation_id=invoice_item_presentations.id and (public.can_manage_operations() or s.created_by=auth.uid()))
  )$policy$;
 end if;
end $$;

create function public.manager_dashboard()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_today date:=(now() at time zone 'Asia/Karachi')::date; v_days integer; v_result jsonb;
begin
 if not public.can_manage_operations() then raise exception 'Operations permission required' using errcode='42501'; end if;
 select expiry_alert_days into v_days from public.pharmacy_settings where id;
 with inventory as (
  select m.id,m.reorder_level,
   coalesce(sum(b.quantity_on_hand) filter(where b.expiry_date>=v_today and not b.is_quarantined),0) qty,
   min(b.expiry_date) filter(where b.expiry_date>=v_today and not b.is_quarantined) nearest_expiry
  from public.medicines m left join public.medicine_batches b on b.medicine_id=m.id and b.quantity_on_hand>0
  where m.is_active group by m.id,m.reorder_level
 ) select jsonb_build_object('total_medicines',count(*),
  'low_stock_items',count(*) filter(where qty>0 and qty<=reorder_level),
  'out_of_stock_items',count(*) filter(where qty<=0),
  'expiring_items',count(*) filter(where nearest_expiry<=v_today+v_days)) into v_result from inventory;
 return v_result;
end $$;
revoke all on function public.manager_dashboard() from public,anon;
grant execute on function public.manager_dashboard() to authenticated;

-- Supplier operations need quantities and last delivery dates, never spend totals.
create function public.supplier_operational_summary(p_supplier_id uuid,p_include_medicines boolean default true)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
 if not public.can_manage_operations() then raise exception 'Operations permission required' using errcode='42501'; end if;
 with receipts as (select id,invoice_date,status from public.purchases where supplier_id=p_supplier_id),
 supplied as (select i.medicine_id,max(r.invoice_date) last_purchase from receipts r
  join public.purchase_items i on i.purchase_id=r.id where r.status='posted' group by i.medicine_id)
 select jsonb_build_object('deliveries',(select count(*) from receipts where status='posted'),
  'drafts',(select count(*) from receipts where status='draft'),
  'medicineCount',(select count(*) from supplied),
  'lastPurchase',(select max(invoice_date) from receipts where status='posted'),
  'lastPurchases',case when p_include_medicines then coalesce((select jsonb_object_agg(medicine_id::text,last_purchase) from supplied),'{}'::jsonb) else '{}'::jsonb end
 ) into v_result;
 return v_result;
end $$;
revoke all on function public.supplier_operational_summary(uuid,boolean) from public,anon;
grant execute on function public.supplier_operational_summary(uuid,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
