begin;

-- Add only the missing business-information field. Existing rows remain unchanged.
alter table public.suppliers add column if not exists city text;
comment on column public.suppliers.city is 'Optional supplier business city; independent of historical purchase and stock records.';

notify pgrst, 'reload schema';
commit;
