begin;

-- Preserve the original batch allocation and cumulative refund arithmetic.
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



create or replace function private.review_sale_return(p_return_id uuid,p_approve boolean,p_items jsonb default '[]'::jsonb,p_review_notes text default null,p_payment_method public.payment_method default 'cash')
returns numeric language plpgsql security definer set search_path='' as $$
begin
 if not public.is_owner() then raise exception 'Owner permission required' using errcode='42501'; end if;
 return private.apply_sale_return(p_return_id,p_approve,p_items,p_review_notes,p_payment_method);
end $$;

create function private.complete_sale_return(p_sale_id uuid,p_items jsonb,p_reason text,p_key uuid,p_payment_method public.payment_method default 'cash',p_card_confirmed boolean default false)
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
 select jsonb_build_object('sale_id',p_sale_id,'reason',trim(p_reason),'method',p_payment_method,'items',jsonb_agg(jsonb_build_object('sale_item_id',x.sale_item_id,'quantity',x.quantity,'restockable',coalesce(x.restockable,false)) order by x.sale_item_id)) into v_request
 from jsonb_to_recordset(p_items) as x(sale_item_id uuid,quantity numeric,restockable boolean);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key::text,9));
 select * into v_existing from public.sale_returns where id=p_key;
 if found then
   if v_existing.requested_by<>auth.uid() or v_existing.sale_id<>p_sale_id then raise exception 'Return key already used.' using errcode='42501'; end if;
   select new_data->'request' into v_saved from public.audit_logs where entity_type='sale_returns' and entity_id=p_key::text and action='complete_refund';
   if v_existing.status<>'approved' or v_saved is distinct from v_request then raise exception 'Return key already used with different details.'; end if;
   return jsonb_build_object('id',v_existing.id,'return_number',v_existing.return_number,'refund',v_existing.refund_amount);
 end if;
 select * into v_sale from public.sales where id=p_sale_id for update;
 if not found or (not public.is_owner() and v_sale.created_by<>auth.uid()) then raise exception 'Sale not found or not authorized.' using errcode='42501'; end if;
 if v_sale.status not in ('completed','partially_refunded','refunded') then raise exception 'This sale cannot be returned.'; end if;
 -- The sale lock serializes distinct return keys and the existing legacy review routine.
 for v_item in select * from jsonb_to_recordset(p_items) as x(sale_item_id uuid,quantity numeric,restockable boolean) loop
   select * into v_line from public.sale_items where id=v_item.sale_item_id and sale_id=p_sale_id;
   if not found or v_item.quantity is null or v_item.quantity not between 1 and 999999999 or v_item.quantity<>trunc(v_item.quantity) then raise exception 'Enter whole quantities in the original selling unit.'; end if;
   select coalesce(sum(case when r.status='approved' then ri.approved_quantity when r.status='requested' then ri.quantity else 0 end),0) into v_reserved
   from public.return_items ri join public.sale_returns r on r.id=ri.return_id where ri.sale_item_id=v_line.id;
   if v_item.quantity+v_reserved>v_line.quantity then raise exception 'Return quantity exceeds the eligible quantity for %.',v_line.medicine_name; end if;
 end loop;
 v_number:='RET-'||to_char(now() at time zone 'Asia/Karachi','YYYYMMDDHH24MISS')||'-'||p_key::text;
 insert into public.sale_returns(id,return_number,sale_id,reason,requested_by) values(p_key,v_number,p_sale_id,trim(p_reason),auth.uid());
 insert into public.return_items(return_id,sale_item_id,quantity)
 select p_key,x.sale_item_id,x.quantity from jsonb_to_recordset(p_items) as x(sale_item_id uuid,quantity numeric);
 select jsonb_agg(jsonb_build_object('return_item_id',ri.id,'approved_quantity',ri.quantity,'restockable',coalesce(x.restockable,false))) into v_review
 from public.return_items ri join jsonb_to_recordset(p_items) as x(sale_item_id uuid,quantity numeric,restockable boolean) on x.sale_item_id=ri.sale_item_id where ri.return_id=p_key;
 -- No requested row can commit: allocation, refund, status and audit all succeed together.
 v_refund:=private.apply_sale_return(p_key,true,v_review,null,p_payment_method);
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
 values(auth.uid(),'complete_refund','sale_returns',p_key::text,jsonb_build_object('request',v_request,'refund_amount',v_refund,'original_cashier',v_sale.created_by,'cashier',auth.uid(),'sale_id',p_sale_id));
 return jsonb_build_object('id',p_key,'return_number',v_number,'refund',v_refund);
end $$;

create function public.complete_sale_return(p_sale_id uuid,p_items jsonb,p_reason text,p_key uuid,p_payment_method public.payment_method default 'cash',p_card_confirmed boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select private.complete_sale_return(p_sale_id,p_items,p_reason,p_key,p_payment_method,p_card_confirmed) $$;

-- A scoped read prevents hidden returns by another cashier from inflating eligibility.
create function public.return_sales(p_query text default '',p_date date default null,p_limit integer default 11,p_offset integer default 0,p_sale_id uuid default null)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
declare v_query text:=trim(coalesce(p_query,'')); v_pattern text;
begin
 if public.is_active_staff() is distinct from true then raise exception 'Not authorized' using errcode='42501'; end if;
 if char_length(v_query)>100 then raise exception 'Search is too long.'; end if;
 v_pattern:='%'||replace(replace(replace(v_query,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 return query select jsonb_build_object('id',s.id,'invoice_number',s.invoice_number,'completed_at',s.completed_at,'cashier',p.full_name,'subtotal',s.subtotal,'net_total',s.net_total,
 'sale_items',coalesce((select jsonb_agg(jsonb_build_object('id',si.id,'medicine_name',si.medicine_name,'quantity',si.quantity,'unit_label',coalesce(si.unit_label,m.base_unit),'unit_price',si.unit_price,
 'net_line_total',coalesce(si.net_line_total,si.unit_price*si.quantity*case when s.subtotal>0 then s.net_total/s.subtotal else 0 end),
 'approved',coalesce(a.approved,0),'available',greatest(0,si.quantity-coalesce(a.approved,0)-coalesce(a.pending,0))) order by si.id)
 from public.sale_items si join public.medicines m on m.id=si.medicine_id left join lateral (
 select sum(ri.approved_quantity) filter(where sr.status='approved') approved,sum(ri.quantity) filter(where sr.status='requested') pending
 from public.return_items ri join public.sale_returns sr on sr.id=ri.return_id where ri.sale_item_id=si.id
 ) a on true where si.sale_id=s.id),'[]'::jsonb))
 from public.sales s join public.profiles p on p.id=s.created_by
 where (public.is_owner() or s.created_by=auth.uid()) and s.status in ('completed','partially_refunded','refunded')
 and (p_sale_id is null or s.id=p_sale_id)
 and (p_date is null or (s.completed_at >= (p_date::timestamp at time zone 'Asia/Karachi') and s.completed_at < ((p_date+1)::timestamp at time zone 'Asia/Karachi')))
 and (v_query='' or s.invoice_number ilike v_pattern or exists(select 1 from public.sale_items si where si.sale_id=s.id and si.medicine_name ilike v_pattern))
 order by s.completed_at desc,s.id desc limit least(greatest(p_limit,1),11) offset greatest(p_offset,0);
end $$;

revoke all on function private.apply_sale_return(uuid,boolean,jsonb,text,public.payment_method) from public,anon,authenticated;
revoke all on function private.complete_sale_return(uuid,jsonb,text,uuid,public.payment_method,boolean),public.complete_sale_return(uuid,jsonb,text,uuid,public.payment_method,boolean),public.return_sales(text,date,integer,integer,uuid) from public,anon;
grant execute on function private.complete_sale_return(uuid,jsonb,text,uuid,public.payment_method,boolean),public.complete_sale_return(uuid,jsonb,text,uuid,public.payment_method,boolean),public.return_sales(text,date,integer,integer,uuid) to authenticated;
commit;
