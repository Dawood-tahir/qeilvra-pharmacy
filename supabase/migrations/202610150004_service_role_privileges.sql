-- The server-only key is used only for owner bootstrap and owner-managed user
-- provisioning. Browser/authenticated clients continue to rely on RLS.
grant usage on schema public to service_role;
grant select, insert, update on public.profiles to service_role;
grant select, insert on public.user_roles to service_role;
