begin;

create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select ur.role
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.user_id = auth.uid() and p.is_active
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_role() = 'owner'::public.app_role, false)
$$;

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_role() in ('owner'::public.app_role, 'salesperson'::public.app_role)
$$;

revoke all on function public.current_role() from public, anon;
revoke all on function public.is_owner() from public, anon;
revoke all on function public.is_active_staff() from public, anon;
grant execute on function public.current_role() to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_active_staff() to authenticated;

create or replace function public.protect_user_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() = old.user_id and old.role = 'owner'::public.app_role
     and new.role is distinct from old.role then
    raise exception 'The signed-in owner cannot change their own role.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_user_role_before_update
before update on public.user_roles
for each row execute function public.protect_user_role();

create or replace function public.audit_sensitive_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entity_uuid text;
begin
  entity_uuid := coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id'), 'unknown');
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_data, new_data)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    entity_uuid,
    case when tg_op <> 'INSERT' then to_jsonb(old) else null end,
    case when tg_op <> 'DELETE' then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_medicine_changes after insert or update on public.medicines
for each row execute function public.audit_sensitive_change();
create trigger audit_medicine_cost_changes after insert or update on public.medicine_costs
for each row execute function public.audit_sensitive_change();
create trigger audit_expense_changes after insert or update or delete on public.expenses
for each row execute function public.audit_sensitive_change();
create trigger audit_role_changes after insert or update or delete on public.user_roles
for each row execute function public.audit_sensitive_change();
create trigger audit_settings_changes after update on public.pharmacy_settings
for each row execute function public.audit_sensitive_change();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.medicine_categories enable row level security;
alter table public.medicines enable row level security;
alter table public.medicine_costs enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.medicine_batches enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_item_costs enable row level security;
alter table public.payments enable row level security;
alter table public.sale_returns enable row level security;
alter table public.return_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.pharmacy_settings enable row level security;

create policy profiles_read_self_or_owner on public.profiles for select to authenticated
using (id = auth.uid() or public.is_owner());
create policy profiles_owner_update on public.profiles for update to authenticated
using (public.is_owner()) with check (public.is_owner());
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy roles_read_self_or_owner on public.user_roles for select to authenticated
using (user_id = auth.uid() or public.is_owner());
create policy roles_owner_manage on public.user_roles for all to authenticated
using (public.is_owner()) with check (public.is_owner());

create policy categories_staff_read on public.medicine_categories for select to authenticated
using (public.is_active_staff());
create policy categories_owner_manage on public.medicine_categories for all to authenticated
using (public.is_owner()) with check (public.is_owner());

create policy medicines_staff_read on public.medicines for select to authenticated
using (public.is_active_staff() and (is_active or public.is_owner()));
create policy medicines_owner_manage on public.medicines for all to authenticated
using (public.is_owner()) with check (public.is_owner());
create policy medicine_costs_owner_manage on public.medicine_costs for all to authenticated
using (public.is_owner()) with check (public.is_owner());

create policy suppliers_owner_manage on public.suppliers for all to authenticated
using (public.is_owner()) with check (public.is_owner());
create policy purchases_owner_manage on public.purchases for all to authenticated
using (public.is_owner()) with check (public.is_owner());
create policy purchase_items_owner_manage on public.purchase_items for all to authenticated
using (public.is_owner()) with check (public.is_owner());
create policy batches_owner_read on public.medicine_batches for select to authenticated
using (public.is_owner());

create policy sales_read_authorized on public.sales for select to authenticated
using (public.is_owner() or (public.current_role() = 'salesperson' and created_by = auth.uid()));
create policy sale_items_read_authorized on public.sale_items for select to authenticated
using (exists (
  select 1 from public.sales s where s.id = sale_id
  and (public.is_owner() or s.created_by = auth.uid())
));
create policy sale_costs_owner_read on public.sale_item_costs for select to authenticated
using (public.is_owner());
create policy payments_read_authorized on public.payments for select to authenticated
using (exists (
  select 1 from public.sales s where s.id = sale_id
  and (public.is_owner() or s.created_by = auth.uid())
));

create policy returns_read_authorized on public.sale_returns for select to authenticated
using (public.is_owner() or requested_by = auth.uid());
create policy return_items_read_authorized on public.return_items for select to authenticated
using (exists (
  select 1 from public.sale_returns r where r.id = return_id
  and (public.is_owner() or r.requested_by = auth.uid())
));

create policy stock_movements_owner_read on public.stock_movements for select to authenticated
using (public.is_owner());
create policy expense_categories_owner_manage on public.expense_categories for all to authenticated
using (public.is_owner()) with check (public.is_owner());
create policy expenses_owner_manage on public.expenses for all to authenticated
using (public.is_owner()) with check (public.is_owner());

create policy notifications_read_authorized on public.notifications for select to authenticated
using (
  public.is_active_staff()
  and (recipient_id = auth.uid() or recipient_role = public.current_role())
);
create policy notifications_mark_read on public.notifications for update to authenticated
using (recipient_id = auth.uid() or recipient_role = public.current_role())
with check (recipient_id = auth.uid() or recipient_role = public.current_role());
create policy notifications_owner_manage on public.notifications for all to authenticated
using (public.is_owner()) with check (public.is_owner());

create policy audit_owner_read on public.audit_logs for select to authenticated
using (public.is_owner());
create policy settings_owner_manage on public.pharmacy_settings for all to authenticated
using (public.is_owner()) with check (public.is_owner());

revoke all on all tables in schema public from anon;
revoke all on public.sale_item_costs, public.medicine_costs, public.medicine_batches, public.purchase_items,
  public.purchases, public.suppliers, public.expenses, public.expense_categories,
  public.stock_movements, public.audit_logs, public.pharmacy_settings from authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, phone, last_seen_at) on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select on public.medicine_categories to authenticated;
grant select on public.medicines to authenticated;
grant select on public.sales, public.sale_items, public.payments, public.sale_returns,
  public.return_items, public.notifications to authenticated;

grant all on public.medicine_categories, public.medicines, public.suppliers,
  public.purchases, public.purchase_items, public.expense_categories, public.expenses,
  public.notifications, public.pharmacy_settings to authenticated;
revoke insert, update, delete on public.purchases, public.purchase_items from authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select on public.medicine_batches, public.sale_item_costs, public.stock_movements,
  public.audit_logs to authenticated;
grant all on public.medicine_costs to authenticated;
grant insert, update, delete on public.user_roles to authenticated;

create or replace function public.search_sellable_medicines(
  p_query text default '',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  generic_name text,
  manufacturer text,
  strength text,
  dosage_form text,
  barcode text,
  sku text,
  selling_price numeric,
  base_unit text,
  available_quantity numeric,
  nearest_expiry date,
  stock_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_active_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select
    m.id, m.name, m.generic_name, m.manufacturer, m.strength, m.dosage_form,
    m.barcode, m.sku, m.selling_price, m.base_unit,
    coalesce(sum(b.quantity_on_hand) filter (
      where b.expiry_date >= (now() at time zone 'Asia/Karachi')::date
        and not b.is_quarantined
    ), 0)::numeric as available_quantity,
    min(b.expiry_date) filter (
      where b.quantity_on_hand > 0
        and b.expiry_date >= (now() at time zone 'Asia/Karachi')::date
        and not b.is_quarantined
    ) as nearest_expiry,
    case
      when coalesce(sum(b.quantity_on_hand) filter (
        where b.expiry_date >= (now() at time zone 'Asia/Karachi')::date and not b.is_quarantined
      ), 0) <= 0 then 'out_of_stock'
      when coalesce(sum(b.quantity_on_hand) filter (
        where b.expiry_date >= (now() at time zone 'Asia/Karachi')::date and not b.is_quarantined
      ), 0) <= m.reorder_level then 'low_stock'
      else 'in_stock'
    end as stock_status
  from public.medicines m
  left join public.medicine_batches b on b.medicine_id = m.id and b.quantity_on_hand > 0
  where m.is_active
    and (
      coalesce(trim(p_query), '') = ''
      or m.barcode = trim(p_query)
      or m.sku ilike trim(p_query) || '%'
      or m.name ilike '%' || trim(p_query) || '%'
      or coalesce(m.generic_name, '') ilike '%' || trim(p_query) || '%'
    )
  group by m.id
  order by
    case when m.barcode = trim(p_query) then 0 when m.sku = trim(p_query) then 1 else 2 end,
    m.name
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.search_sellable_medicines(text, integer, integer) from public, anon;
grant execute on function public.search_sellable_medicines(text, integer, integer) to authenticated;

create or replace function public.save_medicine(p_medicine_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_selling_price numeric := (p_data->>'selling_price')::numeric;
  v_purchase_cost numeric := coalesce((p_data->>'purchase_price')::numeric, 0);
begin
  if not public.is_owner() then raise exception 'Owner permission required' using errcode = '42501'; end if;
  if v_selling_price < 0 or v_purchase_cost < 0 then raise exception 'Prices cannot be negative.'; end if;
  if p_medicine_id is null then
    insert into public.medicines(
      name, generic_name, manufacturer, category_id, strength, dosage_form,
      barcode, sku, selling_price, reorder_level, base_unit, units_per_pack,
      is_active, created_by
    ) values (
      trim(p_data->>'name'), nullif(trim(p_data->>'generic_name'), ''), nullif(trim(p_data->>'manufacturer'), ''),
      nullif(p_data->>'category_id', '')::uuid, nullif(trim(p_data->>'strength'), ''), nullif(trim(p_data->>'dosage_form'), ''),
      nullif(trim(p_data->>'barcode'), ''), trim(p_data->>'sku'), v_selling_price,
      (p_data->>'reorder_level')::numeric, trim(p_data->>'base_unit'), (p_data->>'units_per_pack')::numeric,
      coalesce((p_data->>'is_active')::boolean, true), auth.uid()
    ) returning id into v_id;
    insert into public.medicine_costs(medicine_id, default_purchase_cost, updated_by)
    values (v_id, v_purchase_cost, auth.uid());
  else
    update public.medicines set
      name = trim(p_data->>'name'), generic_name = nullif(trim(p_data->>'generic_name'), ''),
      manufacturer = nullif(trim(p_data->>'manufacturer'), ''), category_id = nullif(p_data->>'category_id', '')::uuid,
      strength = nullif(trim(p_data->>'strength'), ''), dosage_form = nullif(trim(p_data->>'dosage_form'), ''),
      barcode = nullif(trim(p_data->>'barcode'), ''), sku = trim(p_data->>'sku'),
      selling_price = v_selling_price, reorder_level = (p_data->>'reorder_level')::numeric,
      base_unit = trim(p_data->>'base_unit'), units_per_pack = (p_data->>'units_per_pack')::numeric,
      is_active = coalesce((p_data->>'is_active')::boolean, true),
      archived_at = case when coalesce((p_data->>'is_active')::boolean, true) then null else coalesce(archived_at, now()) end
    where id = p_medicine_id returning id into v_id;
    if v_id is null then raise exception 'Medicine not found.'; end if;
    insert into public.medicine_costs(medicine_id, default_purchase_cost, updated_by)
    values (v_id, v_purchase_cost, auth.uid())
    on conflict (medicine_id) do update set default_purchase_cost = excluded.default_purchase_cost, updated_by = auth.uid();
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_medicine(uuid, jsonb) from public, anon;
grant execute on function public.save_medicine(uuid, jsonb) to authenticated;

create or replace function public.checkout_sale(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_tendered_amount numeric,
  p_discount numeric default 0,
  p_idempotency_key uuid default gen_random_uuid(),
  p_customer_name text default null,
  p_payment_reference text default null
)
returns table (sale_id uuid, invoice_number text, net_total numeric, change_amount numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role := public.current_role();
  v_sale_id uuid;
  v_invoice text;
  v_subtotal numeric(14,2) := 0;
  v_net numeric(14,2);
  v_change numeric(14,2) := 0;
  v_max_discount numeric(5,2);
  v_item record;
  v_batch record;
  v_medicine public.medicines%rowtype;
  v_sale_item_id uuid;
  v_remaining numeric(12,3);
begin
  if v_user_id is null or v_role is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one medicine to the sale.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'A sale cannot contain more than 100 line items.' using errcode = '22023';
  end if;

  -- Serialize retries carrying the same key before checking for an existing sale.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key::text, 0));

  select s.id, s.invoice_number, s.net_total,
    coalesce(p.change_amount, 0)
  into v_sale_id, v_invoice, v_net, v_change
  from public.sales s
  left join public.payments p on p.sale_id = s.id and p.kind = 'sale'
  where s.idempotency_key = p_idempotency_key and s.created_by = v_user_id;

  if found then
    return query select v_sale_id, v_invoice, v_net, v_change;
    return;
  end if;

  select salesperson_max_discount_percent into v_max_discount
  from public.pharmacy_settings where id = true;

  for v_item in
    select x.medicine_id, sum(x.quantity)::numeric(12,3) as quantity
    from jsonb_to_recordset(p_items) as x(medicine_id uuid, quantity numeric)
    group by x.medicine_id
    order by x.medicine_id
  loop
    if v_item.medicine_id is null or v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'Each item needs a valid medicine and positive quantity.' using errcode = '22023';
    end if;

    select * into v_medicine from public.medicines
    where id = v_item.medicine_id and is_active
    for share;
    if not found then
      raise exception 'A selected medicine is unavailable.' using errcode = 'P0001';
    end if;

    perform 1 from public.medicine_batches b
    where b.medicine_id = v_item.medicine_id
      and b.quantity_on_hand > 0
      and not b.is_quarantined
      and b.expiry_date >= (now() at time zone 'Asia/Karachi')::date
    order by b.expiry_date, b.created_at
    for update;

    if coalesce((select sum(b.quantity_on_hand) from public.medicine_batches b
      where b.medicine_id = v_item.medicine_id
        and b.quantity_on_hand > 0 and not b.is_quarantined
        and b.expiry_date >= (now() at time zone 'Asia/Karachi')::date), 0) = 0
      and exists (select 1 from public.medicine_batches b
        where b.medicine_id = v_item.medicine_id and b.quantity_on_hand > 0
          and not b.is_quarantined and b.expiry_date < (now() at time zone 'Asia/Karachi')::date) then
      raise exception 'This batch has expired and cannot be sold.' using errcode = 'P0001';
    end if;

    if coalesce((select sum(b.quantity_on_hand) from public.medicine_batches b
      where b.medicine_id = v_item.medicine_id
        and b.quantity_on_hand > 0 and not b.is_quarantined
        and b.expiry_date >= (now() at time zone 'Asia/Karachi')::date), 0) < v_item.quantity then
      raise exception 'Only % units available for %.',
        coalesce((select sum(b.quantity_on_hand) from public.medicine_batches b
          where b.medicine_id = v_item.medicine_id and b.quantity_on_hand > 0
            and not b.is_quarantined
            and b.expiry_date >= (now() at time zone 'Asia/Karachi')::date), 0),
        v_medicine.name using errcode = 'P0001';
    end if;
    v_subtotal := v_subtotal + round(v_item.quantity * v_medicine.selling_price, 2);
  end loop;

  p_discount := coalesce(p_discount, 0);
  if p_discount < 0 or p_discount > v_subtotal then
    raise exception 'Discount is outside the valid range.' using errcode = '22023';
  end if;
  if v_role = 'salesperson' and v_subtotal > 0
     and (p_discount / v_subtotal * 100) > v_max_discount then
    raise exception 'Discount exceeds the salesperson limit of % percent.', v_max_discount using errcode = '42501';
  end if;

  v_net := v_subtotal - p_discount;
  if p_payment_method = 'cash' then
    if p_tendered_amount is null or p_tendered_amount < v_net then
      raise exception 'Cash received is less than the amount due.' using errcode = '22023';
    end if;
    v_change := p_tendered_amount - v_net;
  else
    p_tendered_amount := null;
    v_change := 0;
  end if;

  v_invoice := 'QEI-' || to_char(now() at time zone 'Asia/Karachi', 'YYYYMMDD') || '-'
    || lpad(nextval('public.invoice_number_seq')::text, 6, '0');

  insert into public.sales(invoice_number, idempotency_key, subtotal, discount, net_total, customer_name, created_by)
  values (v_invoice, p_idempotency_key, v_subtotal, p_discount, v_net, nullif(trim(p_customer_name), ''), v_user_id)
  returning id into v_sale_id;

  for v_item in
    select x.medicine_id, sum(x.quantity)::numeric(12,3) as quantity
    from jsonb_to_recordset(p_items) as x(medicine_id uuid, quantity numeric)
    group by x.medicine_id
    order by x.medicine_id
  loop
    select * into v_medicine from public.medicines where id = v_item.medicine_id;
    insert into public.sale_items(sale_id, medicine_id, medicine_name, medicine_sku, quantity, unit_price, line_total)
    values (v_sale_id, v_medicine.id, v_medicine.name, v_medicine.sku, v_item.quantity,
      v_medicine.selling_price, round(v_item.quantity * v_medicine.selling_price, 2))
    returning id into v_sale_item_id;

    v_remaining := v_item.quantity;
    for v_batch in
      select * from public.medicine_batches b
      where b.medicine_id = v_item.medicine_id and b.quantity_on_hand > 0
        and not b.is_quarantined
        and b.expiry_date >= (now() at time zone 'Asia/Karachi')::date
      order by b.expiry_date, b.created_at
      for update
    loop
      exit when v_remaining <= 0;
      declare
        v_take numeric(12,3) := least(v_remaining, v_batch.quantity_on_hand);
        v_after numeric(12,3);
      begin
        update public.medicine_batches
        set quantity_on_hand = quantity_on_hand - v_take
        where id = v_batch.id
        returning quantity_on_hand into v_after;
        insert into public.sale_item_costs(sale_item_id, batch_id, quantity, unit_cost)
        values (v_sale_item_id, v_batch.id, v_take, v_batch.purchase_cost);
        insert into public.stock_movements(
          medicine_id, batch_id, kind, quantity_delta, quantity_after,
          reference_type, reference_id, performed_by
        ) values (
          v_medicine.id, v_batch.id, 'sale', -v_take, v_after,
          'sale', v_sale_id, v_user_id
        );
        v_remaining := v_remaining - v_take;
      end;
    end loop;
  end loop;

  insert into public.payments(
    sale_id, kind, method, amount, tendered_amount, change_amount, reference, received_by
  ) values (
    v_sale_id, 'sale', p_payment_method, v_net, p_tendered_amount, v_change,
    nullif(trim(p_payment_reference), ''), v_user_id
  );

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_data)
  values (v_user_id, 'checkout', 'sales', v_sale_id::text,
    jsonb_build_object('invoice_number', v_invoice, 'net_total', v_net, 'item_count', jsonb_array_length(p_items)));

  return query select v_sale_id, v_invoice, v_net, v_change;
end;
$$;

revoke all on function public.checkout_sale(jsonb, public.payment_method, numeric, numeric, uuid, text, text) from public, anon;
grant execute on function public.checkout_sale(jsonb, public.payment_method, numeric, numeric, uuid, text, text) to authenticated;

create or replace function public.create_purchase(p_data jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase_id uuid := gen_random_uuid();
  v_purchase_number text;
  v_subtotal numeric(14,2);
  v_discount numeric(14,2) := coalesce((p_data->>'discount')::numeric, 0);
  v_item record;
begin
  if not public.is_owner() then raise exception 'Owner permission required' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item to the purchase.';
  end if;
  if not exists (select 1 from public.suppliers where id = (p_data->>'supplier_id')::uuid and is_active) then
    raise exception 'Select an active supplier.';
  end if;
  select round(sum(x.quantity * x.unit_cost), 2) into v_subtotal
  from jsonb_to_recordset(p_items) as x(medicine_id uuid, batch_number text, expiry_date date, quantity numeric, unit_cost numeric);
  if v_subtotal is null or v_subtotal < 0 or v_discount < 0 or v_discount > v_subtotal then
    raise exception 'Purchase totals are invalid.';
  end if;
  v_purchase_number := 'PUR-' || to_char(now() at time zone 'Asia/Karachi', 'YYYYMMDD') || '-'
    || lpad(nextval('public.purchase_number_seq')::text, 6, '0');
  insert into public.purchases(
    id, purchase_number, supplier_id, supplier_invoice_number, invoice_date,
    subtotal, discount, total, notes, created_by
  ) values (
    v_purchase_id, v_purchase_number, (p_data->>'supplier_id')::uuid,
    nullif(trim(p_data->>'supplier_invoice_number'), ''), coalesce((p_data->>'invoice_date')::date, (now() at time zone 'Asia/Karachi')::date),
    v_subtotal, v_discount, v_subtotal - v_discount, nullif(trim(p_data->>'notes'), ''), auth.uid()
  );
  for v_item in select * from jsonb_to_recordset(p_items)
    as x(medicine_id uuid, batch_number text, expiry_date date, quantity numeric, unit_cost numeric)
  loop
    if v_item.quantity <= 0 or v_item.unit_cost < 0 or char_length(trim(v_item.batch_number)) < 1 then
      raise exception 'Each purchase item needs a batch, quantity and valid cost.';
    end if;
    if v_item.expiry_date <= (now() at time zone 'Asia/Karachi')::date then
      raise exception 'Expired stock cannot be added to a purchase.';
    end if;
    if not exists (select 1 from public.medicines where id = v_item.medicine_id and is_active) then
      raise exception 'A selected medicine is inactive or missing.';
    end if;
    insert into public.purchase_items(purchase_id, medicine_id, batch_number, expiry_date, quantity, unit_cost)
    values (v_purchase_id, v_item.medicine_id, trim(v_item.batch_number), v_item.expiry_date, v_item.quantity, v_item.unit_cost);
  end loop;
  return v_purchase_id;
end;
$$;

revoke all on function public.create_purchase(jsonb, jsonb) from public, anon;
grant execute on function public.create_purchase(jsonb, jsonb) to authenticated;

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

  for v_item in select * from public.purchase_items where purchase_id = p_purchase_id order by id
  loop
    insert into public.medicine_batches(
      medicine_id, supplier_id, purchase_item_id, batch_number, expiry_date,
      quantity_on_hand, purchase_cost
    ) values (
      v_item.medicine_id, v_purchase.supplier_id, v_item.id, v_item.batch_number,
      v_item.expiry_date, v_item.quantity, v_item.unit_cost
    )
    on conflict (medicine_id, batch_number, supplier_id) do update set
      quantity_on_hand = public.medicine_batches.quantity_on_hand + excluded.quantity_on_hand,
      purchase_cost = case
        when public.medicine_batches.quantity_on_hand + excluded.quantity_on_hand = 0 then excluded.purchase_cost
        else ((public.medicine_batches.quantity_on_hand * public.medicine_batches.purchase_cost)
          + (excluded.quantity_on_hand * excluded.purchase_cost))
          / (public.medicine_batches.quantity_on_hand + excluded.quantity_on_hand)
      end,
      expiry_date = least(public.medicine_batches.expiry_date, excluded.expiry_date)
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

revoke all on function public.post_purchase(uuid) from public, anon;
grant execute on function public.post_purchase(uuid) to authenticated;

create or replace function public.adjust_stock(
  p_batch_id uuid,
  p_quantity_delta numeric,
  p_reason text
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.medicine_batches%rowtype;
  v_after numeric(12,3);
begin
  if not public.is_owner() then raise exception 'Owner permission required' using errcode = '42501'; end if;
  if p_quantity_delta = 0 then raise exception 'Adjustment quantity cannot be zero.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'A reason is required.'; end if;
  select * into v_batch from public.medicine_batches where id = p_batch_id for update;
  if not found then raise exception 'Batch not found.'; end if;
  if v_batch.quantity_on_hand + p_quantity_delta < 0 then raise exception 'Adjustment would create negative inventory.'; end if;
  update public.medicine_batches set quantity_on_hand = quantity_on_hand + p_quantity_delta
    where id = p_batch_id returning quantity_on_hand into v_after;
  insert into public.stock_movements(
    medicine_id, batch_id, kind, quantity_delta, quantity_after,
    reference_type, reference_id, reason, performed_by
  ) values (
    v_batch.medicine_id, p_batch_id, 'adjustment', p_quantity_delta, v_after,
    'batch', p_batch_id, trim(p_reason), auth.uid()
  );
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_data, new_data)
  values (auth.uid(), 'stock_adjustment', 'medicine_batches', p_batch_id::text,
    jsonb_build_object('quantity', v_batch.quantity_on_hand), jsonb_build_object('quantity', v_after, 'reason', p_reason));
  return v_after;
end;
$$;

revoke all on function public.adjust_stock(uuid, numeric, text) from public, anon;
grant execute on function public.adjust_stock(uuid, numeric, text) to authenticated;

create or replace function public.request_sale_return(
  p_sale_id uuid,
  p_items jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return_id uuid := gen_random_uuid();
  v_return_number text;
  v_item record;
  v_sale_item public.sale_items%rowtype;
  v_already_returned numeric;
begin
  if not public.is_active_staff() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'A return reason is required.'; end if;
  if not exists (select 1 from public.sales where id = p_sale_id
    and (public.is_owner() or created_by = auth.uid())) then
    raise exception 'Sale not found or not authorized.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one item to return.';
  end if;
  v_return_number := 'RET-' || to_char(now() at time zone 'Asia/Karachi', 'YYYYMMDDHH24MISS')
    || '-' || substr(v_return_id::text, 1, 6);
  insert into public.sale_returns(id, return_number, sale_id, reason, requested_by)
  values (v_return_id, v_return_number, p_sale_id, trim(p_reason), auth.uid());

  for v_item in select * from jsonb_to_recordset(p_items) as x(sale_item_id uuid, quantity numeric)
  loop
    select * into v_sale_item from public.sale_items
      where id = v_item.sale_item_id and sale_id = p_sale_id;
    if not found or v_item.quantity <= 0 then raise exception 'Invalid return item.'; end if;
    select coalesce(sum(ri.approved_quantity), 0) into v_already_returned
      from public.return_items ri join public.sale_returns sr on sr.id = ri.return_id
      where ri.sale_item_id = v_sale_item.id and sr.status = 'approved';
    if v_item.quantity + v_already_returned > v_sale_item.quantity then
      raise exception 'Return quantity exceeds the quantity sold for %.', v_sale_item.medicine_name;
    end if;
    insert into public.return_items(return_id, sale_item_id, quantity)
    values (v_return_id, v_sale_item.id, v_item.quantity);
  end loop;
  return v_return_id;
end;
$$;

revoke all on function public.request_sale_return(uuid, jsonb, text) from public, anon;
grant execute on function public.request_sale_return(uuid, jsonb, text) to authenticated;

create or replace function public.review_sale_return(
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
begin
  if not public.is_owner() then raise exception 'Owner permission required' using errcode = '42501'; end if;
  select * into v_return from public.sale_returns where id = p_return_id for update;
  if not found then raise exception 'Return request not found.'; end if;
  if v_return.status <> 'requested' then raise exception 'This return has already been reviewed.'; end if;
  select * into v_sale from public.sales where id = v_return.sale_id for update;

  if not p_approve then
    update public.sale_returns set status = 'rejected', reviewed_by = auth.uid(),
      reviewed_at = now(), review_notes = nullif(trim(p_review_notes), '') where id = p_return_id;
    return 0;
  end if;

  for v_item in select * from jsonb_to_recordset(p_items)
    as x(return_item_id uuid, approved_quantity numeric, restockable boolean)
  loop
    select * into v_return_item from public.return_items
      where id = v_item.return_item_id and return_id = p_return_id for update;
    if not found or v_item.approved_quantity < 0 or v_item.approved_quantity > v_return_item.quantity then
      raise exception 'Invalid approved return quantity.';
    end if;
    select * into v_sale_item from public.sale_items where id = v_return_item.sale_item_id for update;
    select coalesce(sum(ri.approved_quantity), 0) into v_previously_approved
      from public.return_items ri join public.sale_returns sr on sr.id = ri.return_id
      where ri.sale_item_id = v_sale_item.id and sr.status = 'approved';
    if v_previously_approved + v_item.approved_quantity > v_sale_item.quantity then
      raise exception 'Approved returns exceed the quantity sold for %.', v_sale_item.medicine_name;
    end if;
    v_refund := v_refund + round(
      v_item.approved_quantity * v_sale_item.unit_price
        * case when v_sale.subtotal > 0 then v_sale.net_total / v_sale.subtotal else 0 end,
      2
    );
    update public.return_items set approved_quantity = v_item.approved_quantity,
      restockable = coalesce(v_item.restockable, false) where id = v_return_item.id;

    if coalesce(v_item.restockable, false) and v_item.approved_quantity > 0 then
      v_remaining := v_item.approved_quantity;
      for v_allocation in select * from public.sale_item_costs
        where sale_item_id = v_sale_item.id order by created_at desc for update
      loop
        exit when v_remaining <= 0;
        v_take := least(v_remaining, v_allocation.quantity);
        update public.medicine_batches set quantity_on_hand = quantity_on_hand + v_take
          where id = v_allocation.batch_id returning quantity_on_hand into v_after;
        insert into public.stock_movements(
          medicine_id, batch_id, kind, quantity_delta, quantity_after,
          reference_type, reference_id, reason, performed_by
        ) values (
          v_sale_item.medicine_id, v_allocation.batch_id, 'return_restock', v_take, v_after,
          'sale_return', p_return_id, v_return.reason, auth.uid()
        );
        v_remaining := v_remaining - v_take;
      end loop;
    elsif v_item.approved_quantity > 0 then
      insert into public.stock_movements(
        medicine_id, batch_id, kind, quantity_delta, quantity_after,
        reference_type, reference_id, reason, metadata, performed_by
      ) values (
        v_sale_item.medicine_id, null, 'return_non_sellable', 0, null,
        'sale_return', p_return_id, v_return.reason,
        jsonb_build_object('non_sellable_quantity', v_item.approved_quantity), auth.uid()
      );
    end if;
  end loop;

  if v_refund <= 0 then raise exception 'Approve at least one returned unit.'; end if;
  update public.sale_returns set status = 'approved', refund_amount = v_refund,
    reviewed_by = auth.uid(), reviewed_at = now(), review_notes = nullif(trim(p_review_notes), '')
    where id = p_return_id;
  insert into public.payments(sale_id, return_id, kind, method, amount, tendered_amount, change_amount, received_by)
  values (v_return.sale_id, p_return_id, 'refund', p_payment_method, v_refund,
    case when p_payment_method = 'cash' then v_refund else null end, 0, auth.uid());

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

revoke all on function public.review_sale_return(uuid, boolean, jsonb, text, public.payment_method) from public, anon;
grant execute on function public.review_sale_return(uuid, boolean, jsonb, text, public.payment_method) to authenticated;

commit;
