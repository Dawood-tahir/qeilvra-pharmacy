-- Additive, read-only summary. Apply to production only after approval.
-- SECURITY INVOKER keeps every table read subject to the caller's existing RLS.
begin;
create function public.supplier_purchase_summary(p_supplier_id uuid, p_include_medicines boolean default true)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if public.is_owner() is distinct from true then
    raise exception 'Owner permission required' using errcode = '42501';
  end if;
  with receipts as materialized (
    select p.id, p.invoice_date, p.status, p.total
    from public.purchases p where p.supplier_id = p_supplier_id
  ), medicines as (
    select pi.medicine_id, max(p.invoice_date) as last_purchase
    from receipts p join public.purchase_items pi on pi.purchase_id = p.id
    where p.status = 'posted' group by pi.medicine_id
  )
  select jsonb_build_object(
    'total', coalesce((select sum(round(total * 100)) / 100 from receipts where status = 'posted'), 0),
    'deliveries', (select count(*) from receipts where status = 'posted'),
    'drafts', (select count(*) from receipts where status = 'draft'),
    'lastPurchase', (select max(invoice_date) from receipts where status = 'posted'),
    'medicineCount', (select count(*) from medicines),
    'lastPurchases', case when p_include_medicines then coalesce(
      (select jsonb_object_agg(medicine_id::text, last_purchase) from medicines), '{}'::jsonb
    ) else '{}'::jsonb end
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.supplier_purchase_summary(uuid, boolean) from public, anon;
grant execute on function public.supplier_purchase_summary(uuid, boolean) to authenticated;
commit;
