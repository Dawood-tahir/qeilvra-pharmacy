-- The runner clones the actual pre-optimization function before installing migration 011.
-- Compare complete ordered JSON payloads, not just counts or happy-path stock values.
set role authenticated;
do $$
declare actor text; q text; f text; s text; start_at integer; expected jsonb; actual jsonb; checks integer:=0;
begin
 foreach actor in array array['10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002'] loop
  perform set_config('request.jwt.claim.sub',actor,true);
  foreach q in array array['','Para','TEST-PC','%','not found'] loop
   foreach f in array array['all','low_stock','expiring','review'] loop
    foreach s in array array['name','stock','expiry'] loop
     foreach start_at in array array[0,1] loop
      select jsonb_agg(j order by ord) into expected from private.audit_inventory_before(q,2,start_at,f,s) with ordinality t(j,ord);
      select jsonb_agg(j order by ord) into actual from public.inventory_search(q,2,start_at,f,s) with ordinality t(j,ord);
      if actual is distinct from expected then raise exception 'Inventory changed for actor %, query %, filter %, sort %, offset %',actor,q,f,s,start_at; end if;
      checks:=checks+1;
     end loop;
    end loop;
   end loop;
  end loop;
 end loop;
 raise notice 'PASS: all % role/search/filter/sort/pagination combinations match original inventory JSON exactly',checks;
end $$;
reset role;
