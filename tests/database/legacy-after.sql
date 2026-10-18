select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',false);
do $$ begin
if (select quantity_on_hand<>12.5 or purchase_cost<>2 from public.medicine_batches limit 1) then raise exception 'Legacy stock changed'; end if;
if (select quantity<>3.5 or unit_price<>7 or line_total<>24.5 or selling_unit is not null from public.sale_items limit 1) then raise exception 'Legacy invoice changed'; end if;
if (select packaging_status<>'needs_review' or base_unit<>'pack' or units_per_pack<>10 from public.medicines limit 1) then raise exception 'Legacy packaging was invented'; end if;
if exists(select 1 from public.medicine_units) then raise exception 'Legacy units were invented'; end if;
if (public.owner_dashboard_metrics(current_date,current_date)->>'gross_profit')::numeric<>(select profit from legacy_snapshot) then raise exception 'Legacy financial history changed'; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',false);
do $$ begin
begin
 perform public.save_guided_medicine('30000000-0000-0000-0000-000000000002','{"name":"Legacy ambiguous medicine","dosage_form":"Tablet","confirm_existing":true,"units":[{"unit_key":"base","selling_price":7}]}',null,gen_random_uuid());
exception when others then if sqlerrm like 'Existing fractional%' then return; else raise; end if; end;
raise exception 'Fractional legacy stock was silently converted';
end $$;

select public.correct_stock('30000000-0000-0000-0000-000000000003',12,12.5,'Owner physical count: twelve tablets');
select public.save_guided_medicine('30000000-0000-0000-0000-000000000002','{"name":"Legacy ambiguous medicine","dosage_form":"Tablet","confirm_existing":true,"units":[{"unit_key":"base","selling_price":7}]}',null,gen_random_uuid());
do $$ begin
if (select quantity_on_hand<>12 from public.medicine_batches limit 1) then raise exception 'Owner count was not preserved'; end if;
if (select quantity<>3.5 from public.sale_items limit 1) then raise exception 'Owner count rewrote a historical sale'; end if;
end $$;
