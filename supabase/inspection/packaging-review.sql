-- Read-only preflight. Run before rollout and retain the result with the backup.
-- A pack size in the legacy catalogue does NOT prove the unit used by stock balances.
select m.id,m.name,m.strength,m.dosage_form,m.base_unit,m.units_per_pack,
  coalesce(sum(b.quantity_on_hand),0) recorded_stock,
  bool_or(b.quantity_on_hand<>trunc(b.quantity_on_hand)) fractional_stock,
  count(distinct b.id) batch_receipts
from public.medicines m left join public.medicine_batches b on b.medicine_id=m.id
group by m.id order by m.name;
-- Review duplicate identities before confirming medicines; do not merge history automatically.
select lower(trim(name)),lower(trim(coalesce(strength,''))),lower(trim(coalesce(dosage_form,''))),
 lower(trim(coalesce(manufacturer,''))),array_agg(id)
from public.medicines group by 1,2,3,4 having count(*)>1;
