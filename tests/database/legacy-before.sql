insert into auth.users values('30000000-0000-0000-0000-000000000001','legacy@test.local');
insert into public.profiles(id,full_name) values('30000000-0000-0000-0000-000000000001','Legacy Owner');
insert into public.user_roles values('30000000-0000-0000-0000-000000000001','owner',now(),now());
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',false);
insert into public.medicines(id,name,sku,selling_price,base_unit,units_per_pack,created_by) values('30000000-0000-0000-0000-000000000002','Legacy ambiguous medicine','LEGACY',7,'pack',10,'30000000-0000-0000-0000-000000000001');
insert into public.medicine_batches(id,medicine_id,batch_number,expiry_date,quantity_on_hand,purchase_cost) values('30000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','OLD',current_date+500,12.5,2);
insert into public.sales(id,invoice_number,idempotency_key,subtotal,net_total,created_by) values('30000000-0000-0000-0000-000000000004','LEGACY-SALE',gen_random_uuid(),24.5,24.5,'30000000-0000-0000-0000-000000000001');
insert into public.sale_items(id,sale_id,medicine_id,medicine_name,medicine_sku,quantity,unit_price,line_total) values('30000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000002','Legacy ambiguous medicine','LEGACY',3.5,7,24.5);
insert into public.sale_item_costs(sale_item_id,batch_id,quantity,unit_cost) values('30000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000003',3.5,2);

insert into public.sale_returns(id,return_number,sale_id,status,reason,refund_amount,requested_by,reviewed_by,reviewed_at)
values('30000000-0000-0000-0000-000000000006','LEGACY-RETURN','30000000-0000-0000-0000-000000000004','approved','Legacy damaged medicine',10.5,'30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',now());
insert into public.return_items(return_id,sale_item_id,quantity,approved_quantity,restockable)
values('30000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000005',1.5,1.5,false);

create table legacy_snapshot as select (public.owner_dashboard_metrics(current_date,current_date)->>'gross_profit')::numeric profit;
