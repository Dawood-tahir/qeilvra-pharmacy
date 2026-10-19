-- Approved function-only update: per-sale prices; catalogue prices remain unchanged.
-- Replaces only the existing checkout function. No tables, RLS policies, grants, or signatures change.
begin;

create or replace function private.checkout_units(p_items jsonb,p_payment_method public.payment_method,p_tendered_amount numeric,
  p_discount numeric,p_idempotency_key uuid,p_customer_name text,p_payment_reference text)
returns table(sale_id uuid,invoice_number text,net_total numeric,change_amount numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role:=public.current_role(); v_sale uuid; v_invoice text; v_subtotal numeric:=0;
  v_net numeric; v_change numeric:=0; v_max numeric; v_item record; v_batch record;
  v_m public.medicines%rowtype; v_u public.medicine_units%rowtype; v_line uuid; v_remaining bigint;
  v_take bigint; v_after numeric; v_available numeric; v_id uuid;
  v_catalogue_total numeric:=0; v_reductions numeric:=0; v_price numeric;
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
  if p_payment_method is null or p_discount is null or p_discount<>round(p_discount,2) or p_discount>999999999999.99 then raise exception 'Check the payment details.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,quantity numeric)
    where medicine_id is null or quantity is null or quantity<=0 or quantity<>trunc(quantity) or quantity>100000 or coalesce(unit_key,'base') not in ('base','strip','box')) then
    raise exception 'Choose a selling unit and a whole quantity for every medicine.';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(custom_price numeric)
    where custom_price is not null and (custom_price<=0 or custom_price>999999999.99 or custom_price<>round(custom_price,2))) then
    raise exception 'Custom price must be positive with at most two decimal places.';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,quantity numeric,custom_price numeric)
    group by medicine_id,coalesce(unit_key,'base') having sum(quantity)>100000 or count(distinct coalesce(custom_price,-1))>1) then
    raise exception 'Choose one price and at most 100,000 units per medicine selling unit.';
  end if;
  -- Lock medicines in a deterministic order before reading availability. Every stock sale uses this lock.
  for v_id in select distinct x.medicine_id from jsonb_to_recordset(p_items) as x(medicine_id uuid) order by x.medicine_id loop
    select * into v_m from public.medicines where id=v_id and is_active for update;
    if not found or v_m.packaging_status<>'confirmed' then raise exception 'The Owner must confirm this medicine packaging before it can be sold.'; end if;
    perform 1 from public.medicine_batches b where b.medicine_id=v_id order by b.expiry_date,b.created_at,b.id for update;
  end loop;
  for v_item in select x.medicine_id,coalesce(x.unit_key,'base') unit_key,sum(x.quantity) quantity,max(x.custom_price) custom_price
    from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,quantity numeric,custom_price numeric)
    group by x.medicine_id,coalesce(x.unit_key,'base') order by x.medicine_id,coalesce(x.unit_key,'base') loop
    select * into v_u from public.medicine_units where medicine_id=v_item.medicine_id and unit_key=v_item.unit_key;
    if not found then raise exception 'This selling unit is unavailable. Refresh the medicine.'; end if;
    v_price:=coalesce(v_item.custom_price,v_u.selling_price);
    if v_u.max_price is not null and v_price>v_u.max_price then raise exception 'Selling price exceeds the permitted limit.'; end if;
    if exists(select 1 from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,expected_price numeric,catalogue_price numeric)
      where x.medicine_id=v_item.medicine_id and coalesce(x.unit_key,'base')=v_item.unit_key and coalesce(x.catalogue_price,x.expected_price) is not null and coalesce(x.catalogue_price,x.expected_price)<>v_u.selling_price) then
      raise exception 'Selling prices changed. Remove this medicine from the cart and add it again.';
    end if;
    v_catalogue_total:=v_catalogue_total+v_item.quantity*v_u.selling_price;
    v_reductions:=v_reductions+v_item.quantity*greatest(v_u.selling_price-v_price,0);
    v_subtotal:=v_subtotal+round(v_item.quantity*v_price,2);
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
  if v_role='salesperson' and (v_reductions+p_discount)*100>coalesce(v_max,0)*v_catalogue_total then raise exception 'Discount exceeds the salesperson limit.' using errcode='42501'; end if;
  v_net:=v_subtotal-p_discount;
  if v_net<=0 then raise exception 'The sale total must be greater than zero.'; end if;
  if p_payment_method='cash' then
    if p_tendered_amount is null or p_tendered_amount<>round(p_tendered_amount,2) or p_tendered_amount>999999999999.99 or p_tendered_amount<v_net then raise exception 'Cash received is less than the amount due.'; end if;
    v_change:=p_tendered_amount-v_net;
  else p_tendered_amount:=null; end if;
  v_invoice:='QEI-'||to_char(now() at time zone 'Asia/Karachi','YYYYMMDD')||'-'||lpad(nextval('public.invoice_number_seq')::text,6,'0');
  insert into public.sales(invoice_number,idempotency_key,subtotal,discount,net_total,created_by)
    values(v_invoice,p_idempotency_key,v_subtotal,p_discount,v_net,auth.uid()) returning id into v_sale;
  for v_item in select x.medicine_id,coalesce(x.unit_key,'base') unit_key,sum(x.quantity) quantity,max(x.custom_price) custom_price
    from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,quantity numeric,custom_price numeric)
    group by x.medicine_id,coalesce(x.unit_key,'base') order by x.medicine_id,coalesce(x.unit_key,'base') loop
    select * into v_m from public.medicines where id=v_item.medicine_id;
    select * into v_u from public.medicine_units where medicine_id=v_item.medicine_id and unit_key=v_item.unit_key;
    v_remaining:=v_item.quantity*v_u.base_quantity;
    v_price:=coalesce(v_item.custom_price,v_u.selling_price);
    v_line_gross:=round(v_item.quantity*v_price,2);
    v_line_net:=round((v_gross_so_far+v_line_gross)/v_subtotal*v_net,2)-round(v_gross_so_far/v_subtotal*v_net,2);
    v_gross_so_far:=v_gross_so_far+v_line_gross;
    insert into public.sale_items(sale_id,medicine_id,medicine_name,medicine_sku,quantity,unit_price,line_total,selling_unit,unit_label,base_units_per_sale_unit,base_quantity,net_line_total)
      values(v_sale,v_m.id,concat_ws(' ',v_m.name,nullif(v_m.strength,'')),v_m.sku,v_item.quantity,v_price,v_line_gross,v_u.unit_key,v_u.label,v_u.base_quantity,v_remaining,v_line_net) returning id into v_line;
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

commit;
