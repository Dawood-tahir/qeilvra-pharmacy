begin;
create or replace function public.create_purchase(p_data jsonb,p_items jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 v_id uuid:=gen_random_uuid(); v_item record; v_unit public.medicine_units%rowtype;
 v_subtotal numeric:=0; v_discount numeric:=coalesce((p_data->>'discount')::numeric,0);
 v_supplier uuid:=(p_data->>'supplier_id')::uuid; v_number text; v_mid uuid;
begin
 if not public.is_owner() then raise exception 'Owner permission required' using errcode='42501'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Add at least one purchase item.'; end if;
 if not exists(select 1 from public.suppliers where id=v_supplier and is_active) then raise exception 'Select an active supplier.'; end if;
 for v_mid in select distinct x.medicine_id from jsonb_to_recordset(p_items) as x(medicine_id uuid) order by x.medicine_id loop
   perform 1 from public.medicines where id=v_mid and is_active and packaging_status='confirmed' for share;
   if not found then raise exception 'Confirm packaging for each medicine before receiving a purchase.'; end if;
 end loop;
 for v_item in select * from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,quantity numeric,unit_cost numeric,batch_number text,expiry_date date) loop
   select * into v_unit from public.medicine_units where medicine_id=v_item.medicine_id and unit_key=coalesce(v_item.unit_key,'base');
   if not found or v_item.quantity is null or v_item.quantity<=0 or v_item.quantity<>trunc(v_item.quantity) or v_item.quantity*v_unit.base_quantity>999999999 then raise exception 'Enter whole purchased quantities and valid units.'; end if;
   if v_item.unit_cost is null or v_item.unit_cost<0 or v_item.unit_cost<>round(v_item.unit_cost,2) then raise exception 'Enter the purchase cost for one selected unit.'; end if;
   if coalesce(length(trim(v_item.batch_number)),0) not between 1 and 80 or v_item.expiry_date is null or v_item.expiry_date<=(now() at time zone 'Asia/Karachi')::date then raise exception 'Enter a batch number and future expiry date.'; end if;
   v_subtotal:=v_subtotal+round(v_item.quantity*v_item.unit_cost,2);
 end loop;
 if v_discount<0 or v_discount>v_subtotal or v_discount<>round(v_discount,2) then raise exception 'Check the purchase discount.'; end if;
 v_number:='PUR-'||to_char(now() at time zone 'Asia/Karachi','YYYYMMDD')||'-'||lpad(nextval('public.purchase_number_seq')::text,6,'0');
 insert into public.purchases(id,purchase_number,supplier_id,supplier_invoice_number,invoice_date,subtotal,discount,total,notes,created_by)
 values(v_id,v_number,v_supplier,nullif(trim(p_data->>'supplier_invoice_number'),''),coalesce((p_data->>'invoice_date')::date,(now() at time zone 'Asia/Karachi')::date),v_subtotal,v_discount,v_subtotal-v_discount,nullif(trim(p_data->>'notes'),''),auth.uid());
 for v_item in select * from jsonb_to_recordset(p_items) as x(medicine_id uuid,unit_key text,quantity numeric,unit_cost numeric,batch_number text,expiry_date date) loop
   select * into v_unit from public.medicine_units where medicine_id=v_item.medicine_id and unit_key=coalesce(v_item.unit_key,'base');
   insert into public.purchase_items(purchase_id,medicine_id,batch_number,expiry_date,quantity,unit_cost,received_unit,received_quantity,base_units_per_received_unit)
   values(v_id,v_item.medicine_id,trim(v_item.batch_number),v_item.expiry_date,v_item.quantity*v_unit.base_quantity,v_item.unit_cost/v_unit.base_quantity,v_unit.label,v_item.quantity,v_unit.base_quantity);
 end loop;
 return v_id;
end $$;
create function private.correct_stock(p_batch_id uuid,p_counted_quantity integer,p_expected_quantity numeric,p_reason text)
returns numeric language plpgsql security definer set search_path='' as $$
declare v_batch public.medicine_batches%rowtype;
begin
 if not public.is_owner() then raise exception 'Owner permission required' using errcode='42501'; end if;
 if p_counted_quantity is null or p_counted_quantity<0 or char_length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'Enter the counted stock and a reason.'; end if;
 select * into v_batch from public.medicine_batches where id=p_batch_id for update;
 if not found then raise exception 'Batch not found.'; end if;
 if v_batch.quantity_on_hand is distinct from p_expected_quantity then raise exception 'Stock changed while you counted. Refresh this batch and check the physical count again.'; end if;
 if v_batch.quantity_on_hand=p_counted_quantity then return p_counted_quantity; end if;
 return public.adjust_stock(p_batch_id,p_counted_quantity-v_batch.quantity_on_hand,p_reason);
end $$;
create function public.correct_stock(p_batch_id uuid,p_counted_quantity integer,p_expected_quantity numeric,p_reason text)
returns numeric language sql security invoker set search_path='' as $$ select private.correct_stock(p_batch_id,p_counted_quantity,p_expected_quantity,p_reason) $$;
revoke all on function private.correct_stock(uuid,integer,numeric,text),public.correct_stock(uuid,integer,numeric,text) from public,anon;
grant execute on function private.correct_stock(uuid,integer,numeric,text),public.correct_stock(uuid,integer,numeric,text) to authenticated;

commit;
