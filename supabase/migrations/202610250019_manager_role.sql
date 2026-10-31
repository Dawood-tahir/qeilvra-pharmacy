-- Commit this enum addition before applying the permissions migration.
alter type public.app_role add value if not exists 'manager';
