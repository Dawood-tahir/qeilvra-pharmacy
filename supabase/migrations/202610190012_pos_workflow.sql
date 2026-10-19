-- Prepared for approval. Apply to disposable test databases only until deployment is approved.
-- Preserves historical rows, prices, return records, RLS and existing checkout defaults.
begin;
alter table public.sales add column extra_charge_amount numeric(14,2) not null default 0 check(extra_charge_amount>=0 and extra_charge_amount<=999999999.99);
alter table public.sales add column extra_charge_description text check(char_length(extra_charge_description)<=120);
alter table public.sales drop constraint sales_total_check;
alter table public.sales add constraint sales_total_check check(net_total=subtotal-discount+extra_charge_amount);
alter table public.sale_items add column item_discount numeric(14,2) not null default 0 check(item_discount>=0 and item_discount<=line_total);
-- Exact base counts support single-tablet returns from any pack without rounding away stock.
alter table public.return_items alter column quantity type numeric(20,9), alter column approved_quantity type numeric(20,9);
alter table public.return_items add column base_quantity bigint check(base_quantity>0);
alter table public.return_items add column approved_base_quantity bigint check(approved_base_quantity>=0 and approved_base_quantity<=base_quantity);
create or replace function private.check_return_quantity() returns trigger language plpgsql set search_path='' as $$
begin
 if new.base_quantity is not null then
   if new.base_quantity<>trunc(new.base_quantity) then raise exception 'Return whole base units.'; end if;
 elsif exists(select 1 from public.sale_items where id=new.sale_item_id and selling_unit is not null) and (new.quantity<>trunc(new.quantity) or coalesce(new.approved_quantity,0)<>trunc(coalesce(new.approved_quantity,0))) then raise exception 'Return a whole number of the units shown on the receipt.';
 end if;
 return new;
end $$;
drop function public.checkout_sale(jsonb,public.payment_method,numeric,numeric,uuid,text,text);
drop function private.checkout_units(jsonb,public.payment_method,numeric,numeric,uuid,text,text);
create or replace function private.checkout_units(p_items jsonb,p_payment_method public.payment_method,p_tendered_amount numeric,
  p_discount numeric,p_idempotency_key uuid,p_customer_name text,p_payment_reference text,p_extra_amount numeric,p_extra_description text)
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
  if p_extra_amount is null or p_extra_amount::text in ('NaN','Infinity','-Infinity') or p_extra_amount<0 or p_extra_amount>999999999.99 or p_extra_amount<>round(p_extra_amount,2) or char_length(coalesce(p_extra_description,''))>120 then raise exception 'Check the extra charge amount and description.'; end if;
  if p_discount::text in ('NaN','Infinity','-Infinity') then raise exception 'Check the discount.'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where x ? 'custom_price') then raise exception 'Selling prices must come from Inventory.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text) group by medicine_id,coalesce(unit_key,'base') having count(*)>1) then raise exception 'Each selling unit must have one invoice line.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(line_discount numeric) where line_discount::text in ('NaN','Infinity','-Infinity') or line_discount<0 or line_discount<>round(line_discount,2)) then raise exception 'Check the medicine discounts.'; end if;
  -- Lock medicines in a deterministic order before reading availability. Every stock sale uses this lock.
  for v_id in select distinct x.medicine_id from jsonb_to_recordset(p_items) as x(medicine_id uuid) order by x.medicine_id loop
    select * into v_m from public.medicines where id=v_id and is_active for update;
    if not found or v_m.packaging_status<>'confirmed' then raise exception 'The Owner must confirm this medicine packaging before it can be sold.'; end if;
    perform 1 from public.medicine_batches b where b.medicine_id=v_id order by b.expiry_date,b.created_at,b.id for update;
  end loop;
  for v_item in select x.medicine_id,coalesce(x.unit_key,'base') unit_key,sum(x.quantity) quantity,coalesce(max(x.line_discount),0) line_discount
    from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,quantity numeric,line_discount numeric)
    group by x.medicine_id,coalesce(x.unit_key,'base') order by x.medicine_id,coalesce(x.unit_key,'base') loop
    select * into v_u from public.medicine_units where medicine_id=v_item.medicine_id and unit_key=v_item.unit_key;
    if not found then raise exception 'This selling unit is unavailable. Refresh the medicine.'; end if;
    v_price:=v_u.selling_price;
    if v_u.max_price is not null and v_price>v_u.max_price then raise exception 'Selling price exceeds the permitted limit.'; end if;
    if exists(select 1 from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,expected_price numeric,catalogue_price numeric)
      where x.medicine_id=v_item.medicine_id and coalesce(x.unit_key,'base')=v_item.unit_key and coalesce(x.catalogue_price,x.expected_price) is not null and coalesce(x.catalogue_price,x.expected_price)<>v_u.selling_price) then
      raise exception 'Selling prices changed. Remove this medicine from the cart and add it again.';
    end if;
    v_catalogue_total:=v_catalogue_total+v_item.quantity*v_u.selling_price;
    if v_item.line_discount>v_item.quantity*v_price then raise exception 'Medicine discount exceeds its line subtotal.'; end if;
    v_reductions:=v_reductions+v_item.line_discount;
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
  if p_discount<0 or p_discount>v_subtotal-v_reductions then raise exception 'Discount is outside the valid range.'; end if;
  if v_role='salesperson' and (v_reductions+p_discount)*100>coalesce(v_max,0)*v_catalogue_total then raise exception 'Discount exceeds the salesperson limit.' using errcode='42501'; end if;
  v_net:=v_subtotal-v_reductions-p_discount+p_extra_amount;
  if v_net<=0 then raise exception 'The sale total must be greater than zero.'; end if;
  if p_payment_method='cash' then
    if p_tendered_amount is null or p_tendered_amount<>round(p_tendered_amount,2) or p_tendered_amount>999999999999.99 or p_tendered_amount<v_net then raise exception 'Cash received is less than the amount due.'; end if;
    v_change:=p_tendered_amount-v_net;
  else p_tendered_amount:=null; end if;
  v_invoice:='QEI-'||to_char(now() at time zone 'Asia/Karachi','YYYYMMDD')||'-'||lpad(nextval('public.invoice_number_seq')::text,6,'0');
  insert into public.sales(invoice_number,idempotency_key,subtotal,discount,net_total,created_by,extra_charge_amount,extra_charge_description)
    values(v_invoice,p_idempotency_key,v_subtotal,p_discount+v_reductions,v_net,auth.uid(),p_extra_amount,nullif(trim(p_extra_description),'')) returning id into v_sale;
  for v_item in select x.medicine_id,coalesce(x.unit_key,'base') unit_key,sum(x.quantity) quantity,coalesce(max(x.line_discount),0) line_discount
    from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,quantity numeric,line_discount numeric)
    group by x.medicine_id,coalesce(x.unit_key,'base') order by x.medicine_id,coalesce(x.unit_key,'base') loop
    select * into v_m from public.medicines where id=v_item.medicine_id;
    select * into v_u from public.medicine_units where medicine_id=v_item.medicine_id and unit_key=v_item.unit_key;
    v_remaining:=v_item.quantity*v_u.base_quantity;
    v_price:=v_u.selling_price;
    v_line_gross:=round(v_item.quantity*v_price,2);
    v_line_net:=v_line_gross-v_item.line_discount;
    if v_subtotal>v_reductions then
      v_line_net:=round((v_gross_so_far+v_line_net)/(v_subtotal-v_reductions)*(v_subtotal-v_reductions-p_discount),2)-round(v_gross_so_far/(v_subtotal-v_reductions)*(v_subtotal-v_reductions-p_discount),2);
    else v_line_net:=0; end if;
    v_gross_so_far:=v_gross_so_far+v_line_gross-v_item.line_discount;
    insert into public.sale_items(sale_id,medicine_id,medicine_name,medicine_sku,quantity,unit_price,line_total,selling_unit,unit_label,base_units_per_sale_unit,base_quantity,net_line_total,item_discount)
      values(v_sale,v_m.id,concat_ws(' ',v_m.name,nullif(v_m.strength,'')),v_m.sku,v_item.quantity,v_price,v_line_gross,v_u.unit_key,v_u.label,v_u.base_quantity,v_remaining,v_line_net,v_item.line_discount) returning id into v_line;
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

create or replace function private.apply_sale_return(
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
  if public.is_active_staff() is distinct from true then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_approve is null or p_payment_method is null then raise exception 'Check the return decision and payment method.'; end if;
  if p_approve and (jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0) then raise exception 'Select at least one item.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(return_item_id uuid) group by x.return_item_id having count(*)>1) then
    raise exception 'Each return item can be reviewed only once.';
  end if;
  select * into v_return from public.sale_returns where id = p_return_id for update;
  if not found then raise exception 'Return request not found.'; end if;
  if v_return.status <> 'requested' then raise exception 'This return has already been reviewed.'; end if;
  select * into v_sale from public.sales where id = v_return.sale_id for update;
  if not public.is_owner() and (v_return.requested_by<>auth.uid() or v_sale.created_by<>auth.uid()) then raise exception 'Sale not authorized' using errcode='42501'; end if;

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
    select coalesce(sum(coalesce(ri.approved_base_quantity,ri.approved_quantity*coalesce(v_sale_item.base_units_per_sale_unit,1))), 0) into v_previously_approved
      from public.return_items ri join public.sale_returns sr on sr.id = ri.return_id
      where ri.sale_item_id = v_sale_item.id and sr.status = 'approved';
    if v_previously_approved + coalesce(v_return_item.base_quantity,v_item.approved_quantity*coalesce(v_sale_item.base_units_per_sale_unit,1)) > v_sale_item.quantity*coalesce(v_sale_item.base_units_per_sale_unit,1) then
      raise exception 'Approved returns exceed the quantity sold for %.', v_sale_item.medicine_name;
    end if;
    if v_return_item.base_quantity is null and v_sale_item.selling_unit is not null and v_item.approved_quantity<>trunc(v_item.approved_quantity) then raise exception 'Return whole selling units.'; end if;
    -- Use cumulative rounding so multiple partial refunds cannot exceed the original line payment.
    v_target_refund:=round((v_previously_approved+coalesce(v_return_item.base_quantity,v_item.approved_quantity*coalesce(v_sale_item.base_units_per_sale_unit,1)))/coalesce(v_sale_item.base_units_per_sale_unit,1)*coalesce(v_sale_item.net_line_total/v_sale_item.quantity,
      v_sale_item.unit_price*case when v_sale.subtotal>0 then (v_sale.net_total-v_sale.extra_charge_amount)/v_sale.subtotal else 0 end),2);
    v_previous_refund:=round(v_previously_approved/coalesce(v_sale_item.base_units_per_sale_unit,1)*coalesce(v_sale_item.net_line_total/v_sale_item.quantity,
      v_sale_item.unit_price*case when v_sale.subtotal>0 then (v_sale.net_total-v_sale.extra_charge_amount)/v_sale.subtotal else 0 end),2);
    v_refund:=v_refund+v_target_refund-v_previous_refund;
    update public.return_items set approved_quantity = v_item.approved_quantity,
      restockable = coalesce(v_item.restockable, false), approved_base_quantity=case when v_return_item.base_quantity is not null then v_return_item.base_quantity else null end where id = v_return_item.id;


    v_remaining:=coalesce(v_return_item.base_quantity,v_item.approved_quantity*coalesce(v_sale_item.base_units_per_sale_unit,1));
    for v_allocation in select sic.*,b.expiry_date,b.is_quarantined from public.sale_item_costs sic
      join public.medicine_batches b on b.id=sic.batch_id where sic.sale_item_id=v_sale_item.id
      order by b.expiry_date,b.created_at,b.id,sic.id for update of sic loop
      exit when v_remaining<=0;
      select coalesce(sum(ra.base_quantity),0) into v_allocated from public.return_allocations ra where ra.sale_item_cost_id=v_allocation.id;
      -- For historical returns before this migration, skip allocations conservatively in FEFO order.
      if v_sale_item.selling_unit is null then
        select coalesce(sum(coalesce(ri.approved_base_quantity,ri.approved_quantity)),0) into v_returned_count from public.return_items ri
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
    if v_remaining>0 then raise exception 'Returned quantity exceeds its original batch allocations. Check return history before continuing.'; end if;
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
    when not exists(select 1 from public.sale_items si where si.sale_id=s.id and
      si.quantity*coalesce(si.base_units_per_sale_unit,1)>(select coalesce(sum(coalesce(ri.approved_base_quantity,ri.approved_quantity*coalesce(si.base_units_per_sale_unit,1))),0)
        from public.return_items ri join public.sale_returns sr on sr.id=ri.return_id where ri.sale_item_id=si.id and sr.status='approved')) then 'refunded'::public.sale_status
    else 'partially_refunded'::public.sale_status end
    where s.id = v_return.sale_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_data)
  values (auth.uid(), 'approve_refund', 'sale_returns', p_return_id::text,
    jsonb_build_object('refund_amount', v_refund));
  return v_refund;
end;
$$;



create or replace function private.review_sale_return(p_return_id uuid,p_approve boolean,p_items jsonb default '[]'::jsonb,p_review_notes text default null,p_payment_method public.payment_method default 'cash')
returns numeric language plpgsql security definer set search_path='' as $$
begin
 if not public.is_owner() then raise exception 'Owner permission required' using errcode='42501'; end if;
 return private.apply_sale_return(p_return_id,p_approve,p_items,p_review_notes,p_payment_method);
end $$;

create or replace function private.complete_sale_return(p_sale_id uuid,p_items jsonb,p_reason text,p_key uuid,p_payment_method public.payment_method default 'cash',p_card_confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_sale public.sales%rowtype; v_existing public.sale_returns%rowtype;
 v_item record; v_line public.sale_items%rowtype; v_reserved numeric;
 v_number text; v_refund numeric; v_review jsonb; v_request jsonb; v_saved jsonb;
begin
 if public.is_active_staff() is distinct from true then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_key is null or p_sale_id is null or p_payment_method is null then raise exception 'Check the return details.'; end if;
 if char_length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'Enter a reason of 3 to 500 characters.'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Select at least one medicine.'; end if;
 if p_payment_method='card' and p_card_confirmed is distinct from true then raise exception 'Confirm the manual card refund before completing the return.'; end if;
 if exists(select 1 from jsonb_to_recordset(p_items) as x(sale_item_id uuid) group by sale_item_id having count(*)>1) then raise exception 'Each medicine line can be returned only once per return.'; end if;
 select jsonb_build_object('sale_id',p_sale_id,'reason',trim(p_reason),'method',p_payment_method,'items',jsonb_agg(jsonb_build_object('sale_item_id',x.sale_item_id,'quantity',x.quantity,'restockable',coalesce(x.restockable,false),'in_base_units',coalesce(x.in_base_units,false)) order by x.sale_item_id)) into v_request
 from jsonb_to_recordset(p_items) as x(sale_item_id uuid,quantity numeric,restockable boolean,in_base_units boolean);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key::text,9));
 select * into v_existing from public.sale_returns where id=p_key;
 if found then
   if v_existing.requested_by<>auth.uid() or v_existing.sale_id<>p_sale_id then raise exception 'Return key already used.' using errcode='42501'; end if;
   select new_data->'request' into v_saved from public.audit_logs where entity_type='sale_returns' and entity_id=p_key::text and action='complete_refund';
   if v_existing.status<>'approved' or (select jsonb_agg(i-'in_base_units' order by i->>'sale_item_id') from jsonb_array_elements(v_saved->'items') i) is distinct from (select jsonb_agg(i-'in_base_units' order by i->>'sale_item_id') from jsonb_array_elements(v_request->'items') i) or (v_saved-'items') is distinct from (v_request-'items') or (exists(select 1 from jsonb_array_elements(v_request->'items') i where (i->>'in_base_units')::boolean) and v_saved is distinct from v_request) then raise exception 'Return key already used with different details.'; end if;
   return jsonb_build_object('id',v_existing.id,'return_number',v_existing.return_number,'refund',v_existing.refund_amount);
 end if;
 select * into v_sale from public.sales where id=p_sale_id for update;
 if not found or (not public.is_owner() and v_sale.created_by<>auth.uid()) then raise exception 'Sale not found or not authorized.' using errcode='42501'; end if;
 if v_sale.status not in ('completed','partially_refunded','refunded') then raise exception 'This sale cannot be returned.'; end if;
 -- The sale lock serializes distinct return keys and the existing legacy review routine.
 for v_item in select * from jsonb_to_recordset(p_items) as x(sale_item_id uuid,quantity numeric,restockable boolean,in_base_units boolean) loop
   select * into v_line from public.sale_items where id=v_item.sale_item_id and sale_id=p_sale_id;
   if not found or v_item.quantity is null or v_item.quantity not between 1 and 999999999 or v_item.quantity<>trunc(v_item.quantity) then raise exception 'Enter whole quantities in the original selling unit.'; end if;
   select coalesce(sum(case when r.status='approved' then coalesce(ri.approved_base_quantity,ri.approved_quantity*coalesce(v_line.base_units_per_sale_unit,1)) when r.status='requested' then coalesce(ri.base_quantity,ri.quantity*coalesce(v_line.base_units_per_sale_unit,1)) else 0 end),0) into v_reserved
   from public.return_items ri join public.sale_returns r on r.id=ri.return_id where ri.sale_item_id=v_line.id;
   if v_item.quantity*(case when coalesce(v_item.in_base_units,false) then 1 else coalesce(v_line.base_units_per_sale_unit,1) end)+v_reserved>v_line.quantity*coalesce(v_line.base_units_per_sale_unit,1) then raise exception 'Return quantity exceeds the eligible quantity for %.',v_line.medicine_name; end if;
 end loop;
 v_number:='RET-'||to_char(now() at time zone 'Asia/Karachi','YYYYMMDDHH24MISS')||'-'||p_key::text;
 insert into public.sale_returns(id,return_number,sale_id,reason,requested_by) values(p_key,v_number,p_sale_id,trim(p_reason),auth.uid());
 insert into public.return_items(return_id,sale_item_id,quantity,base_quantity)
 select p_key,x.sale_item_id,case when coalesce(x.in_base_units,false) then x.quantity/coalesce(si.base_units_per_sale_unit,1) else x.quantity end,
 x.quantity*case when coalesce(x.in_base_units,false) then 1 else coalesce(si.base_units_per_sale_unit,1) end
 from jsonb_to_recordset(p_items) as x(sale_item_id uuid,quantity numeric,in_base_units boolean) join public.sale_items si on si.id=x.sale_item_id;
 select jsonb_agg(jsonb_build_object('return_item_id',ri.id,'approved_quantity',ri.quantity,'restockable',coalesce(x.restockable,false))) into v_review
 from public.return_items ri join jsonb_to_recordset(p_items) as x(sale_item_id uuid,quantity numeric,restockable boolean,in_base_units boolean) on x.sale_item_id=ri.sale_item_id where ri.return_id=p_key;
 -- No requested row can commit: allocation, refund, status and audit all succeed together.
 v_refund:=private.apply_sale_return(p_key,true,v_review,null,p_payment_method);
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
 values(auth.uid(),'complete_refund','sale_returns',p_key::text,jsonb_build_object('request',v_request,'refund_amount',v_refund,'original_cashier',v_sale.created_by,'cashier',auth.uid(),'sale_id',p_sale_id));
 return jsonb_build_object('id',p_key,'return_number',v_number,'refund',v_refund);
end $$;

create or replace function public.complete_sale_return(p_sale_id uuid,p_items jsonb,p_reason text,p_key uuid,p_payment_method public.payment_method default 'cash',p_card_confirmed boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select private.complete_sale_return(p_sale_id,p_items,p_reason,p_key,p_payment_method,p_card_confirmed) $$;

-- A scoped read prevents hidden returns by another cashier from inflating eligibility.
create or replace function public.return_sales(p_query text default '',p_date date default null,p_limit integer default 11,p_offset integer default 0,p_sale_id uuid default null)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
declare v_query text:=trim(coalesce(p_query,'')); v_pattern text;
begin
 if public.is_active_staff() is distinct from true then raise exception 'Not authorized' using errcode='42501'; end if;
 if char_length(v_query)>100 then raise exception 'Search is too long.'; end if;
 v_pattern:='%'||replace(replace(replace(v_query,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 return query select jsonb_build_object('id',s.id,'invoice_number',s.invoice_number,'completed_at',s.completed_at,'cashier',p.full_name,'subtotal',s.subtotal,'net_total',s.net_total,
 'sale_items',coalesce((select jsonb_agg(jsonb_build_object('id',si.id,'medicine_name',si.medicine_name,'quantity',si.quantity,'unit_label',coalesce(si.unit_label,m.base_unit),'unit_price',si.unit_price,
 'net_line_total',coalesce(si.net_line_total,si.unit_price*si.quantity*case when s.subtotal>0 then (s.net_total-s.extra_charge_amount)/s.subtotal else 0 end),
 'base_units_per_sale_unit',coalesce(si.base_units_per_sale_unit,1),'base_unit',m.base_unit,
 'approved_base_quantity',coalesce(a.approved,0),'available_base_quantity',greatest(0,si.quantity*coalesce(si.base_units_per_sale_unit,1)-coalesce(a.approved,0)-coalesce(a.pending,0)),
 'approved',coalesce(a.approved,0)/coalesce(si.base_units_per_sale_unit,1),'available',greatest(0,si.quantity-(coalesce(a.approved,0)+coalesce(a.pending,0))/coalesce(si.base_units_per_sale_unit,1))) order by si.id)
 from public.sale_items si join public.medicines m on m.id=si.medicine_id left join lateral (
 select sum(coalesce(ri.approved_base_quantity,ri.approved_quantity*coalesce(si.base_units_per_sale_unit,1))) filter(where sr.status='approved') approved,sum(coalesce(ri.base_quantity,ri.quantity*coalesce(si.base_units_per_sale_unit,1))) filter(where sr.status='requested') pending
 from public.return_items ri join public.sale_returns sr on sr.id=ri.return_id where ri.sale_item_id=si.id
 ) a on true where si.sale_id=s.id),'[]'::jsonb))
 from public.sales s join public.profiles p on p.id=s.created_by
 where (public.is_owner() or s.created_by=auth.uid()) and s.status in ('completed','partially_refunded','refunded')
 and (p_sale_id is null or s.id=p_sale_id)
 and (p_date is null or (s.completed_at >= (p_date::timestamp at time zone 'Asia/Karachi') and s.completed_at < ((p_date+1)::timestamp at time zone 'Asia/Karachi')))
 and (v_query='' or s.invoice_number ilike v_pattern or exists(select 1 from public.sale_items si where si.sale_id=s.id and si.medicine_name ilike v_pattern))
 order by s.completed_at desc,s.id desc limit least(greatest(p_limit,1),11) offset greatest(p_offset,0);
end $$;

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
    select s.id, s.net_total, s.extra_charge_amount
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
      coalesce(ri.approved_base_quantity,coalesce(ri.approved_quantity,0)*coalesce(si.base_units_per_sale_unit,1))*coalesce(unit_costs.avg_cost,0)) else 0 end) as amount
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
      coalesce(sum(ps.extra_charge_amount),0) as extra_revenue,
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
    'extra_charge_revenue', round(f.extra_revenue,2),
    'medicine_revenue', round(f.revenue-f.extra_revenue,2),
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
    select ri.sale_item_id, sum(coalesce(ri.approved_base_quantity,ri.approved_quantity*coalesce(si.base_units_per_sale_unit,1))) quantity
    from public.return_items ri join public.sale_returns sr on sr.id = ri.return_id
    join public.sale_items si on si.id=ri.sale_item_id
    join period_sales ps on ps.id = sr.sale_id
    where sr.status = 'approved' group by ri.sale_item_id
  ), medicine_sales as (
    select si.medicine_id, si.medicine_name,
      sum((si.quantity*coalesce(si.base_units_per_sale_unit,1) - coalesce(r.quantity, 0))) as quantity,
      sum(coalesce(si.net_line_total,si.line_total*case when ps.subtotal>0 then (ps.net_total-ps.extra_charge_amount)/ps.subtotal else 0 end)-round(coalesce(r.quantity,0)/coalesce(si.base_units_per_sale_unit,1)*coalesce(si.net_line_total/si.quantity,si.unit_price*case when ps.subtotal>0 then (ps.net_total-ps.extra_charge_amount)/ps.subtotal else 0 end),2)) as revenue
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
    'extra_charge_revenue',coalesce((select sum(extra_charge_amount) from period_sales),0),
    'medicine_sales', coalesce((select jsonb_agg(to_jsonb(ms)) from medicine_sales ms), '[]'::jsonb),
    'salesperson_performance', coalesce((select jsonb_agg(to_jsonb(sp)) from salesperson sp), '[]'::jsonb),
    'purchase_total', coalesce((select sum(p.total) from public.purchases p where p.status = 'posted' and p.invoice_date between p_from and p_to), 0),
    'refund_total', coalesce((select sum(sr.refund_amount) from public.sale_returns sr join period_sales ps on ps.id = sr.sale_id where sr.status = 'approved'), 0),
    'return_count', (select count(*) from public.sale_returns sr join period_sales ps on ps.id = sr.sale_id where sr.status = 'approved')
  ) into v_result;
  return v_result;
end;
$$;


create function public.checkout_sale(p_items jsonb,p_payment_method public.payment_method,p_tendered_amount numeric,p_discount numeric default 0,p_idempotency_key uuid default gen_random_uuid(),p_customer_name text default null,p_payment_reference text default null,p_extra_amount numeric default 0,p_extra_description text default null)
returns table(sale_id uuid,invoice_number text,net_total numeric,change_amount numeric) language sql security invoker set search_path='' as $$ select * from private.checkout_units(p_items,p_payment_method,p_tendered_amount,p_discount,p_idempotency_key,p_customer_name,p_payment_reference,p_extra_amount,p_extra_description) $$;
revoke all on function public.checkout_sale(jsonb,public.payment_method,numeric,numeric,uuid,text,text,numeric,text),private.checkout_units(jsonb,public.payment_method,numeric,numeric,uuid,text,text,numeric,text) from public,anon;
grant execute on function public.checkout_sale(jsonb,public.payment_method,numeric,numeric,uuid,text,text,numeric,text),private.checkout_units(jsonb,public.payment_method,numeric,numeric,uuid,text,text,numeric,text) to authenticated;
revoke all on function private.apply_sale_return(uuid,boolean,jsonb,text,public.payment_method),private.check_return_quantity() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
