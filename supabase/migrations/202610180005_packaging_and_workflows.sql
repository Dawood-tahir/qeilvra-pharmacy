begin;

-- Existing quantities and financial rows are deliberately not rescaled or rewritten.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter table public.medicines add column packaging_status text not null default 'needs_review'
  check (packaging_status in ('needs_review', 'confirmed'));
alter table public.medicines add column tablets_per_strip integer check (tablets_per_strip > 0);
alter table public.medicines add column strips_per_box integer check (strips_per_box > 0);

create table public.medicine_units (
  medicine_id uuid not null references public.medicines(id),
  unit_key text not null check (unit_key in ('base','strip','box')),
  label text not null,
  base_quantity integer not null check (base_quantity between 1 and 999999999),
  selling_price numeric(14,2) not null check (selling_price > 0),
  max_price numeric(14,2) check (max_price > 0 and selling_price <= max_price),
  primary key (medicine_id, unit_key)
);
alter table public.medicine_units enable row level security;
create policy units_staff_read on public.medicine_units for select to authenticated using (public.is_active_staff());
revoke all on public.medicine_units from public, anon, authenticated;
grant select on public.medicine_units to authenticated;
create trigger audit_unit_changes after insert or update or delete on public.medicine_units
for each row execute function public.audit_sensitive_change();

alter table public.sale_items drop constraint sale_items_sale_id_medicine_id_key;
alter table public.sale_items add column selling_unit text;
alter table public.sale_items add column net_line_total numeric(14,2) check (net_line_total >= 0);
alter table public.sale_items add column unit_label text;
alter table public.sale_items add column base_units_per_sale_unit integer check (base_units_per_sale_unit > 0);
alter table public.sale_items add column base_quantity numeric(12,3);
create unique index sale_items_unit_key on public.sale_items(sale_id, medicine_id, selling_unit) where selling_unit is not null;
alter table public.purchase_items add column received_unit text;
alter table public.purchase_items add column received_quantity integer;
alter table public.purchase_items add column base_units_per_received_unit integer;
-- Retain a new receipt for every purchase even if its manufacturer batch repeats.
alter table public.medicine_batches drop constraint medicine_batches_medicine_id_batch_number_supplier_id_key;
alter table public.purchases alter column supplier_id drop not null;
alter table public.medicine_batches alter column purchase_cost type numeric;
alter table public.sale_item_costs alter column unit_cost type numeric;
-- DROP EXPRESSION retains every historical line_total value, while allowing exact new per-base costs.
alter table public.purchase_items alter column line_total drop expression;
alter table public.purchase_items alter column unit_cost type numeric;
create function private.purchase_line_total() returns trigger language plpgsql set search_path='' as $$
begin new.line_total:=round(new.quantity*new.unit_cost,2); return new; end $$;
create trigger purchase_line_total before insert or update of quantity,unit_cost on public.purchase_items
for each row execute function private.purchase_line_total();

create table public.stock_receipts (
  request_key uuid primary key,
  medicine_id uuid not null references public.medicines(id),
  purchase_id uuid not null references public.purchases(id),
  base_quantity integer not null check (base_quantity > 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.stock_receipts enable row level security;
create policy receipts_owner_read on public.stock_receipts for select to authenticated using (public.is_owner());
revoke all on public.stock_receipts from public, anon, authenticated;
grant select on public.stock_receipts to authenticated;

-- Tracks consumed return allocations, including non-saleable returns, to prevent reuse.
create table public.return_allocations (
  return_item_id uuid not null references public.return_items(id),
  sale_item_cost_id uuid not null references public.sale_item_costs(id),
  base_quantity numeric not null check (base_quantity > 0),
  unit_cost numeric not null check (unit_cost >= 0),
  primary key (return_item_id, sale_item_cost_id)
);
alter table public.return_allocations enable row level security;
create policy return_cost_owner_read on public.return_allocations for select to authenticated using (public.is_owner());
revoke all on public.return_allocations from public, anon, authenticated;
grant select on public.return_allocations to authenticated;

-- Master data must pass the same validation as the guided form.
revoke insert, update, delete on public.medicines, public.medicine_costs from authenticated;
revoke execute on function public.save_medicine(uuid,jsonb) from authenticated;

create function private.configure_medicine(p_id uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid()); v_old public.medicines%rowtype;
  v_type text := p_data->>'dosage_form'; v_base text;
  v_strip integer := nullif(p_data->>'tablets_per_strip','')::integer;
  v_box integer := nullif(p_data->>'strips_per_box','')::integer;
  v_unit record; v_factor integer; v_price numeric; v_limit numeric;
begin
  if not public.is_owner() then raise exception 'Owner permission required' using errcode='42501'; end if;
  if coalesce(length(trim(p_data->>'name')),0) < 2 or v_type is null or
    v_type not in ('Tablet','Capsule','Syrup','Injection','Cream','Sachet','Other') then
    raise exception 'Enter a medicine name and choose its type.';
  end if;
  v_base := case v_type when 'Tablet' then 'tablet' when 'Capsule' then 'capsule'
    when 'Syrup' then 'bottle' when 'Injection' then 'injection' when 'Cream' then 'tube'
    when 'Sachet' then 'sachet' else 'unit' end;
  if (v_strip is not null or v_box is not null) and v_type not in ('Tablet','Capsule') then
    raise exception 'This medicine must be sold as a whole sealed item.';
  end if;
  if v_strip <= 0 or v_box <= 0 or (v_box is not null and v_strip is null) then
    raise exception 'Confirm the number of tablets in a strip and strips in a box.';
  end if;
  if coalesce(v_strip,1)::bigint * coalesce(v_box,1)::bigint > 999999999 then raise exception 'The pack size is too large.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    lower(trim(p_data->>'name')) || '|' || lower(trim(coalesce(p_data->>'strength',''))) || '|' || lower(v_type), 1));
  if exists(select 1 from public.medicines m where m.id <> v_id
    and lower(trim(m.name))=lower(trim(p_data->>'name'))
    and lower(trim(coalesce(m.strength,'')))=lower(trim(coalesce(p_data->>'strength','')))
    and lower(trim(coalesce(m.dosage_form,'')))=lower(v_type)
    and lower(trim(coalesce(m.manufacturer,'')))=lower(trim(coalesce(p_data->>'manufacturer','')))) then
    raise exception 'This medicine already exists. Use Add More Stock.' using errcode='23505';
  end if;
  if p_id is not null then
    select * into v_old from public.medicines where id=p_id for update;
    if not found then raise exception 'Medicine not found.'; end if;
    if v_old.packaging_status='needs_review' and coalesce((p_data->>'confirm_existing')::boolean,false) is not true then
      raise exception 'Confirm that existing stock counts already represent the selected smallest unit.';
    end if;
    if exists(select 1 from public.medicine_batches where medicine_id=p_id and quantity_on_hand<>trunc(quantity_on_hand)) then
      raise exception 'Existing fractional stock requires a physical count and Owner review before packaging can be confirmed.';
    end if;
    if v_old.packaging_status='confirmed' and (v_old.base_unit<>v_base or v_old.tablets_per_strip is distinct from v_strip or v_old.strips_per_box is distinct from v_box) then
      raise exception 'Packaging is fixed for traceability. Add a separate medicine for a different pack configuration.';
    end if;
  end if;
  if jsonb_typeof(p_data->'units') is distinct from 'array' or jsonb_array_length(p_data->'units') < 1 then
    raise exception 'Enter a selling price.';
  end if;
  if (select count(*) from jsonb_array_elements(p_data->'units') u where u->>'unit_key'='base')<>1 then raise exception 'Enter the smallest unit price.'; end if;
  insert into public.medicines(id,name,generic_name,manufacturer,strength,dosage_form,barcode,sku,selling_price,
    reorder_level,base_unit,units_per_pack,is_active,created_by,packaging_status,tablets_per_strip,strips_per_box)
  values(v_id,trim(p_data->>'name'),nullif(trim(p_data->>'generic_name'),''),nullif(trim(p_data->>'manufacturer'),''),
    nullif(trim(p_data->>'strength'),''),v_type,nullif(trim(p_data->>'barcode'),''),
    coalesce(nullif(trim(p_data->>'sku'),''),'MED-'||substr(v_id::text,1,8)),
    (select (u->>'selling_price')::numeric from jsonb_array_elements(p_data->'units') u where u->>'unit_key'='base'),
    coalesce((p_data->>'reorder_level')::integer,10),v_base,coalesce(v_strip,1)*coalesce(v_box,1),true,auth.uid(),'confirmed',v_strip,v_box)
  on conflict(id) do update set name=excluded.name,generic_name=excluded.generic_name,manufacturer=excluded.manufacturer,
    strength=excluded.strength,dosage_form=excluded.dosage_form,barcode=excluded.barcode,selling_price=excluded.selling_price,
    reorder_level=excluded.reorder_level,base_unit=excluded.base_unit,units_per_pack=excluded.units_per_pack,
    packaging_status='confirmed',tablets_per_strip=v_strip,strips_per_box=v_box,
    is_active=coalesce((p_data->>'is_active')::boolean,true),
    archived_at=case when coalesce((p_data->>'is_active')::boolean,true) then null else now() end;
  delete from public.medicine_units where medicine_id=v_id;
  for v_unit in select * from jsonb_to_recordset(p_data->'units') as x(unit_key text,selling_price numeric,max_price numeric)
  loop
    v_factor := case v_unit.unit_key when 'base' then 1 when 'strip' then v_strip when 'box' then v_strip*v_box else null end;
    if v_factor is null or v_unit.selling_price is null or v_unit.selling_price not between 0.01 and 999999999999.99 or v_unit.selling_price<>round(v_unit.selling_price,2)
      or (v_unit.max_price is not null and (v_unit.max_price not between 0.01 and 999999999999.99 or v_unit.max_price<>round(v_unit.max_price,2))) then
      raise exception 'Choose valid selling units and prices with at most two decimal places.';
    end if;
    insert into public.medicine_units values(v_id,v_unit.unit_key,
      case v_unit.unit_key when 'base' then v_base else v_unit.unit_key end,v_factor,v_unit.selling_price,v_unit.max_price);
  end loop;
  return v_id;
end $$;

create function private.receive_stock(p_id uuid,p_stock jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_m public.medicines%rowtype; v_unit public.medicine_units%rowtype; v_existing public.stock_receipts%rowtype;
  v_count numeric := (p_stock->>'quantity')::numeric; v_total bigint;
  v_cost numeric := (p_stock->>'total_cost')::numeric; v_expiry date := (p_stock->>'expiry_date')::date;
  v_purchase uuid; v_item uuid; v_batch uuid; v_number text;
begin
  if not public.is_owner() then raise exception 'Owner permission required' using errcode='42501'; end if;
  if p_key is null then raise exception 'A request key is required.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key::text,2));
  select * into v_existing from public.stock_receipts where request_key=p_key;
  if found then
    if v_existing.created_by<>auth.uid() or v_existing.medicine_id<>p_id then raise exception 'Request key already used.'; end if;
    return jsonb_build_object('id',p_id,'quantity',v_existing.base_quantity,'purchase_id',v_existing.purchase_id);
  end if;
  select * into v_m from public.medicines where id=p_id and is_active for update;
  if not found or v_m.packaging_status<>'confirmed' then raise exception 'The Owner must confirm this medicine packaging first.'; end if;
  select * into v_unit from public.medicine_units where medicine_id=p_id and unit_key=p_stock->>'unit_key';
  if not found or v_count is null or v_count<=0 or v_count<>trunc(v_count) or v_count>999999999 then raise exception 'Enter a whole number of purchased items.'; end if;
  v_total := v_count*v_unit.base_quantity;
  if v_total>999999999 then raise exception 'The stock quantity is too large.'; end if;
  if v_cost is null or v_cost<0 or v_cost<>round(v_cost,2) then raise exception 'Enter the total purchase cost with at most two decimal places.'; end if;
  if coalesce(length(trim(p_stock->>'batch_number')),0) not between 1 and 80 or v_expiry is null or v_expiry<=(now() at time zone 'Asia/Karachi')::date then
    raise exception 'Enter a batch number and a future expiry date.';
  end if;
  v_number := 'PUR-'||to_char(now() at time zone 'Asia/Karachi','YYYYMMDD')||'-'||lpad(nextval('public.purchase_number_seq')::text,6,'0');
  insert into public.purchases(purchase_number,supplier_id,invoice_date,status,subtotal,total,posted_at,created_by)
  values(v_number,nullif(p_stock->>'supplier_id','')::uuid,(now() at time zone 'Asia/Karachi')::date,'posted',v_cost,v_cost,now(),auth.uid()) returning id into v_purchase;
  insert into public.purchase_items(purchase_id,medicine_id,batch_number,expiry_date,quantity,unit_cost,received_unit,received_quantity,base_units_per_received_unit)
  values(v_purchase,p_id,trim(p_stock->>'batch_number'),v_expiry,v_total,v_cost/v_total,v_unit.label,v_count,v_unit.base_quantity) returning id into v_item;
  insert into public.medicine_batches(medicine_id,supplier_id,purchase_item_id,batch_number,expiry_date,quantity_on_hand,purchase_cost)
  values(p_id,nullif(p_stock->>'supplier_id','')::uuid,v_item,trim(p_stock->>'batch_number'),v_expiry,v_total,v_cost/v_total) returning id into v_batch;
  insert into public.stock_movements(medicine_id,batch_id,kind,quantity_delta,quantity_after,reference_type,reference_id,performed_by)
  values(p_id,v_batch,'purchase',v_total,v_total,'purchase',v_purchase,auth.uid());
  insert into public.stock_receipts values(p_key,p_id,v_purchase,v_total,auth.uid(),now());
  return jsonb_build_object('id',p_id,'quantity',v_total,'purchase_id',v_purchase);
end $$;

create function private.save_guided_medicine(p_id uuid,p_data jsonb,p_stock jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_receipt public.stock_receipts%rowtype;
begin
  if not public.is_owner() then raise exception 'Owner permission required' using errcode='42501'; end if;
  if p_key is null then raise exception 'A request key is required.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key::text,2));
  select * into v_receipt from public.stock_receipts where request_key=p_key;
  if found then
    if v_receipt.created_by<>auth.uid() then raise exception 'Request key already used.'; end if;
    return jsonb_build_object('id',v_receipt.medicine_id,'quantity',v_receipt.base_quantity);
  end if;
  if p_id is null and p_stock is null then raise exception 'Enter the first batch of stock.'; end if;
  v_id := private.configure_medicine(p_id,p_data);
  if p_stock is not null then return private.receive_stock(v_id,p_stock,p_key); end if;
  return jsonb_build_object('id',v_id,'quantity',0);
end $$;
create function public.save_guided_medicine(p_id uuid,p_data jsonb,p_stock jsonb,p_key uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.save_guided_medicine(p_id,p_data,p_stock,p_key) $$;
create function public.receive_stock(p_id uuid,p_stock jsonb,p_key uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.receive_stock(p_id,p_stock,p_key) $$;

-- This trigger protects all stock writers, including the pre-existing purchase/adjustment RPCs.
create function private.check_discrete_stock() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.quantity_on_hand<>trunc(new.quantity_on_hand) then raise exception 'Stock must be a whole number of physical items.'; end if;
  if not exists(select 1 from public.medicines where id=new.medicine_id and packaging_status='confirmed') then
    -- A physical correction can resolve fractional legacy stock before confirmation.
    if tg_op='INSERT' then raise exception 'Confirm packaging before adding stock.'; end if;
  end if;
  return new;
end $$;
create trigger discrete_stock before insert or update of quantity_on_hand on public.medicine_batches for each row execute function private.check_discrete_stock();

create function private.checkout_units(p_items jsonb,p_payment_method public.payment_method,p_tendered_amount numeric,
  p_discount numeric,p_idempotency_key uuid,p_customer_name text,p_payment_reference text)
returns table(sale_id uuid,invoice_number text,net_total numeric,change_amount numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role:=public.current_role(); v_sale uuid; v_invoice text; v_subtotal numeric:=0;
  v_net numeric; v_change numeric:=0; v_max numeric; v_item record; v_batch record;
  v_m public.medicines%rowtype; v_u public.medicine_units%rowtype; v_line uuid; v_remaining bigint;
  v_take bigint; v_after numeric; v_available numeric; v_id uuid;
  v_gross_so_far numeric:=0; v_line_gross numeric; v_line_net numeric;
begin
  if v_role is null or auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_idempotency_key is null then raise exception 'A checkout request key is required.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key::text,0));
  return query select s.id,s.invoice_number,s.net_total,p.change_amount from public.sales s
    join public.payments p on p.sale_id=s.id and p.kind='sale'
    where s.idempotency_key=p_idempotency_key and s.created_by=auth.uid();
  if found then return; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Add at least one medicine to the sale.'; end if;
  if p_payment_method is null or p_discount is null or p_discount<>round(p_discount,2) then raise exception 'Check the payment details.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,quantity numeric)
    where medicine_id is null or quantity is null or quantity<=0 or quantity<>trunc(quantity) or quantity>100000 or coalesce(unit_key,'base') not in ('base','strip','box')) then
    raise exception 'Choose a selling unit and a whole quantity for every medicine.';
  end if;
  -- Lock medicines in a deterministic order before reading availability. Every stock sale uses this lock.
  for v_id in select distinct x.medicine_id from jsonb_to_recordset(p_items) as x(medicine_id uuid) order by x.medicine_id loop
    select * into v_m from public.medicines where id=v_id and is_active for update;
    if not found or v_m.packaging_status<>'confirmed' then raise exception 'The Owner must confirm this medicine packaging before it can be sold.'; end if;
    perform 1 from public.medicine_batches b where b.medicine_id=v_id order by b.expiry_date,b.created_at,b.id for update;
  end loop;
  for v_item in select x.medicine_id,coalesce(x.unit_key,'base') unit_key,sum(x.quantity) quantity
    from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,quantity numeric)
    group by x.medicine_id,coalesce(x.unit_key,'base') order by x.medicine_id,coalesce(x.unit_key,'base') loop
    select * into v_u from public.medicine_units where medicine_id=v_item.medicine_id and unit_key=v_item.unit_key;
    if not found then raise exception 'This selling unit is unavailable. Refresh the medicine.'; end if;
    if v_u.max_price is not null and v_u.selling_price>v_u.max_price then raise exception 'Selling price exceeds the permitted limit.'; end if;
    if exists(select 1 from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,expected_price numeric)
      where x.medicine_id=v_item.medicine_id and coalesce(x.unit_key,'base')=v_item.unit_key and x.expected_price is not null and x.expected_price<>v_u.selling_price) then
      raise exception 'Selling prices changed. Remove this medicine from the cart and add it again.';
    end if;
    v_subtotal:=v_subtotal+round(v_item.quantity*v_u.selling_price,2);
  end loop;
  for v_item in select x.medicine_id,sum(x.quantity*u.base_quantity) needed
    from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,quantity numeric)
    join public.medicine_units u on u.medicine_id=x.medicine_id and u.unit_key=coalesce(x.unit_key,'base') group by x.medicine_id loop
    select * into v_m from public.medicines where id=v_item.medicine_id;
    select coalesce(sum(b.quantity_on_hand),0) into v_available from public.medicine_batches b
      where b.medicine_id=v_item.medicine_id and not b.is_quarantined and b.expiry_date>=(now() at time zone 'Asia/Karachi')::date;
    if v_available<v_item.needed then
      if v_available=0 and exists(select 1 from public.medicine_batches b where b.medicine_id=v_item.medicine_id and b.quantity_on_hand>0 and b.expiry_date<(now() at time zone 'Asia/Karachi')::date) then
        raise exception 'This batch has expired and cannot be sold.';
      end if;
      raise exception 'Only % %s are available for %.',v_available,v_m.base_unit,v_m.name;
    end if;
  end loop;
  select salesperson_max_discount_percent into v_max from public.pharmacy_settings where id;
  if p_discount<0 or p_discount>v_subtotal then raise exception 'Discount is outside the valid range.'; end if;
  if v_role='salesperson' and p_discount/nullif(v_subtotal,0)*100>v_max then raise exception 'Discount exceeds the salesperson limit.' using errcode='42501'; end if;
  v_net:=v_subtotal-p_discount;
  if v_net<=0 then raise exception 'The sale total must be greater than zero.'; end if;
  if p_payment_method='cash' then
    if p_tendered_amount is null or p_tendered_amount<>round(p_tendered_amount,2) or p_tendered_amount<v_net then raise exception 'Cash received is less than the amount due.'; end if;
    v_change:=p_tendered_amount-v_net;
  else p_tendered_amount:=null; end if;
  v_invoice:='QEI-'||to_char(now() at time zone 'Asia/Karachi','YYYYMMDD')||'-'||lpad(nextval('public.invoice_number_seq')::text,6,'0');
  insert into public.sales(invoice_number,idempotency_key,subtotal,discount,net_total,created_by)
    values(v_invoice,p_idempotency_key,v_subtotal,p_discount,v_net,auth.uid()) returning id into v_sale;
  for v_item in select x.medicine_id,coalesce(x.unit_key,'base') unit_key,sum(x.quantity) quantity
    from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,quantity numeric)
    group by x.medicine_id,coalesce(x.unit_key,'base') order by x.medicine_id,coalesce(x.unit_key,'base') loop
    select * into v_m from public.medicines where id=v_item.medicine_id;
    select * into v_u from public.medicine_units where medicine_id=v_item.medicine_id and unit_key=v_item.unit_key;
    v_remaining:=v_item.quantity*v_u.base_quantity;
    v_line_gross:=round(v_item.quantity*v_u.selling_price,2);
    v_line_net:=round((v_gross_so_far+v_line_gross)/v_subtotal*v_net,2)-round(v_gross_so_far/v_subtotal*v_net,2);
    v_gross_so_far:=v_gross_so_far+v_line_gross;
    insert into public.sale_items(sale_id,medicine_id,medicine_name,medicine_sku,quantity,unit_price,line_total,selling_unit,unit_label,base_units_per_sale_unit,base_quantity,net_line_total)
      values(v_sale,v_m.id,concat_ws(' ',v_m.name,nullif(v_m.strength,'')),v_m.sku,v_item.quantity,v_u.selling_price,round(v_item.quantity*v_u.selling_price,2),v_u.unit_key,v_u.label,v_u.base_quantity,v_remaining,v_line_net) returning id into v_line;
    for v_batch in select * from public.medicine_batches b where b.medicine_id=v_m.id and b.quantity_on_hand>0 and not b.is_quarantined
      and b.expiry_date>=(now() at time zone 'Asia/Karachi')::date order by b.expiry_date,b.created_at,b.id for update loop
      exit when v_remaining=0;
      v_take:=least(v_remaining,v_batch.quantity_on_hand);
      update public.medicine_batches set quantity_on_hand=quantity_on_hand-v_take where id=v_batch.id returning quantity_on_hand into v_after;
      insert into public.sale_item_costs(sale_item_id,batch_id,quantity,unit_cost) values(v_line,v_batch.id,v_take,v_batch.purchase_cost);
      insert into public.stock_movements(medicine_id,batch_id,kind,quantity_delta,quantity_after,reference_type,reference_id,performed_by)
        values(v_m.id,v_batch.id,'sale',-v_take,v_after,'sale',v_sale,auth.uid());
      v_remaining:=v_remaining-v_take;
    end loop;
    if v_remaining<>0 then raise exception 'Stock changed. Review the available quantity and try again.'; end if;
  end loop;
  insert into public.payments(sale_id,kind,method,amount,tendered_amount,change_amount,reference,received_by)
    values(v_sale,'sale',p_payment_method,v_net,p_tendered_amount,v_change,nullif(trim(p_payment_reference),''),auth.uid());
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
    values(auth.uid(),'checkout','sales',v_sale::text,jsonb_build_object('invoice_number',v_invoice,'net_total',v_net));
  return query select v_sale,v_invoice,v_net,v_change;
end $$;
create or replace function public.checkout_sale(p_items jsonb,p_payment_method public.payment_method,p_tendered_amount numeric,
 p_discount numeric default 0,p_idempotency_key uuid default gen_random_uuid(),p_customer_name text default null,p_payment_reference text default null)
returns table(sale_id uuid,invoice_number text,net_total numeric,change_amount numeric)
language sql security invoker set search_path = '' as $$ select * from private.checkout_units(p_items,p_payment_method,p_tendered_amount,p_discount,p_idempotency_key,p_customer_name,p_payment_reference) $$;

-- Keep the old search contract for existing dashboard consumers. The new inventory search adds units/filtering before pagination.
create function private.inventory_search(p_query text,p_limit integer,p_offset integer,p_filter text,p_sort text)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_active_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  return query
  with stock as (
    select m.*,coalesce(b.qty,0) available_quantity,b.expiry nearest_expiry,
      case when coalesce(b.qty,0)<=0 then 'out_of_stock' when b.qty<=m.reorder_level then 'low_stock' else 'in_stock' end stock_status,
      coalesce((select jsonb_agg(to_jsonb(u) - 'medicine_id' order by u.base_quantity) from public.medicine_units u where u.medicine_id=m.id),'[]'::jsonb) units
    from public.medicines m left join lateral (
      select sum(mb.quantity_on_hand) qty,min(mb.expiry_date) expiry from public.medicine_batches mb
      where mb.medicine_id=m.id and mb.quantity_on_hand>0 and not mb.is_quarantined and mb.expiry_date>=(now() at time zone 'Asia/Karachi')::date
    ) b on true where (m.is_active or public.is_owner()) and (coalesce(trim(p_query),'')='' or m.barcode=trim(p_query) or m.sku ilike trim(p_query)||'%'
      or m.name ilike '%'||trim(p_query)||'%' or m.generic_name ilike '%'||trim(p_query)||'%')
  ) select (to_jsonb(s) - 'created_by') || jsonb_build_object('expiring_soon',coalesce(s.nearest_expiry<=(now() at time zone 'Asia/Karachi')::date+(select expiry_alert_days from public.pharmacy_settings where id),false)) from stock s where
    case p_filter when 'low_stock' then s.available_quantity<=s.reorder_level
      when 'expiring' then s.nearest_expiry<=(now() at time zone 'Asia/Karachi')::date+(select expiry_alert_days from public.pharmacy_settings where id)
      when 'review' then s.packaging_status='needs_review' else true end
    order by case when s.barcode=trim(p_query) then 0 when s.sku=trim(p_query) then 1 else 2 end,
      case when p_sort='stock' then s.available_quantity end,
      case when p_sort='expiry' then s.nearest_expiry end nulls last,s.name,s.id
    limit least(greatest(p_limit,1),50) offset greatest(p_offset,0);
end $$;
create function public.inventory_search(p_query text default '',p_limit integer default 20,p_offset integer default 0,p_filter text default 'all',p_sort text default 'name')
returns setof jsonb language sql security invoker set search_path = '' as $$ select * from private.inventory_search(p_query,p_limit,p_offset,p_filter,p_sort) $$;

-- Deny fractional new sales/returns without changing historical rows.
create function private.check_return_quantity() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from public.sale_items where id=new.sale_item_id and selling_unit is not null) and
    (new.quantity<>trunc(new.quantity) or coalesce(new.approved_quantity,0)<>trunc(coalesce(new.approved_quantity,0))) then
    raise exception 'Return a whole number of the units shown on the receipt.';
  end if;
  return new;
end $$;
create trigger discrete_returns before insert or update on public.return_items for each row execute function private.check_return_quantity();

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.save_guided_medicine(uuid,jsonb,jsonb,uuid),private.receive_stock(uuid,jsonb,uuid),
 private.checkout_units(jsonb,public.payment_method,numeric,numeric,uuid,text,text),private.inventory_search(text,integer,integer,text,text) to authenticated;
revoke all on function public.save_guided_medicine(uuid,jsonb,jsonb,uuid),public.receive_stock(uuid,jsonb,uuid),public.inventory_search(text,integer,integer,text,text) from public,anon;
grant execute on function public.save_guided_medicine(uuid,jsonb,jsonb,uuid),public.receive_stock(uuid,jsonb,uuid),public.inventory_search(text,integer,integer,text,text) to authenticated;

commit;
