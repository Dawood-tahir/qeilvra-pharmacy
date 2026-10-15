begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create type public.app_role as enum ('owner', 'salesperson');
create type public.purchase_status as enum ('draft', 'posted', 'cancelled');
create type public.sale_status as enum ('completed', 'partially_refunded', 'refunded');
create type public.payment_method as enum ('cash', 'card');
create type public.payment_kind as enum ('sale', 'refund');
create type public.return_status as enum ('requested', 'approved', 'rejected');
create type public.stock_movement_kind as enum (
  'purchase', 'sale', 'adjustment', 'return_restock', 'return_non_sellable'
);

create sequence public.invoice_number_seq start 1;
create sequence public.purchase_number_seq start 1;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 100),
  phone text,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.medicine_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medicine_categories_name_key unique (name)
);

create table public.medicines (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 160),
  generic_name text,
  manufacturer text,
  category_id uuid references public.medicine_categories(id) on delete set null,
  strength text,
  dosage_form text,
  barcode text,
  sku text not null,
  selling_price numeric(14,2) not null check (selling_price >= 0),
  reorder_level numeric(12,3) not null default 10 check (reorder_level >= 0),
  base_unit text not null default 'unit' check (char_length(trim(base_unit)) between 1 and 32),
  units_per_pack numeric(12,3) not null default 1 check (units_per_pack > 0),
  is_active boolean not null default true,
  archived_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medicines_sku_key unique (sku),
  constraint medicines_barcode_key unique (barcode),
  constraint medicines_archival_check check ((is_active and archived_at is null) or not is_active)
);

comment on table public.medicines is 'Sales-safe catalogue. Purchase cost is intentionally stored in owner-only tables.';

create table public.medicine_costs (
  medicine_id uuid primary key references public.medicines(id) on delete restrict,
  default_purchase_cost numeric(14,4) not null default 0 check (default_purchase_cost >= 0),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 160),
  contact_person text,
  phone text,
  email text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  address text,
  tax_number text,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_number text not null unique,
  supplier_id uuid not null references public.suppliers(id),
  supplier_invoice_number text,
  invoice_date date not null default current_date,
  status public.purchase_status not null default 'draft',
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  notes text,
  posted_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_status_posted_check check (
    (status = 'posted' and posted_at is not null) or (status <> 'posted')
  ),
  constraint purchase_total_check check (total = subtotal - discount and discount <= subtotal)
);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  medicine_id uuid not null references public.medicines(id),
  batch_number text not null check (char_length(trim(batch_number)) between 1 and 80),
  expiry_date date not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  line_total numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  created_at timestamptz not null default now(),
  unique (purchase_id, medicine_id, batch_number)
);

create table public.medicine_batches (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references public.medicines(id),
  supplier_id uuid references public.suppliers(id),
  purchase_item_id uuid references public.purchase_items(id),
  batch_number text not null,
  expiry_date date not null,
  quantity_on_hand numeric(12,3) not null default 0 check (quantity_on_hand >= 0),
  purchase_cost numeric(14,4) not null check (purchase_cost >= 0),
  is_quarantined boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (medicine_id, batch_number, supplier_id)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  idempotency_key uuid not null unique,
  status public.sale_status not null default 'completed',
  subtotal numeric(14,2) not null check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0 and discount <= subtotal),
  net_total numeric(14,2) not null check (net_total >= 0),
  customer_name text,
  created_by uuid not null references public.profiles(id),
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint sales_total_check check (net_total = subtotal - discount)
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  medicine_id uuid not null references public.medicines(id),
  medicine_name text not null,
  medicine_sku text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (sale_id, medicine_id)
);

create table public.sale_item_costs (
  id uuid primary key default gen_random_uuid(),
  sale_item_id uuid not null references public.sale_items(id),
  batch_id uuid not null references public.medicine_batches(id),
  quantity numeric(12,3) not null check (quantity > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  unique (sale_item_id, batch_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  return_id uuid,
  kind public.payment_kind not null default 'sale',
  method public.payment_method not null,
  amount numeric(14,2) not null check (amount > 0),
  tendered_amount numeric(14,2),
  change_amount numeric(14,2) not null default 0 check (change_amount >= 0),
  reference text,
  received_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint payment_cash_check check (
    (method = 'cash' and tendered_amount is not null and tendered_amount >= amount)
    or (method = 'card' and change_amount = 0)
  )
);

create table public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  return_number text not null unique,
  sale_id uuid not null references public.sales(id),
  status public.return_status not null default 'requested',
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  refund_amount numeric(14,2) not null default 0 check (refund_amount >= 0),
  requested_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  review_notes text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint return_review_check check (
    (status = 'requested' and reviewed_by is null and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
  )
);

alter table public.payments
  add constraint payments_return_id_fkey foreign key (return_id) references public.sale_returns(id);

create table public.return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sale_returns(id) on delete cascade,
  sale_item_id uuid not null references public.sale_items(id),
  quantity numeric(12,3) not null check (quantity > 0),
  approved_quantity numeric(12,3) check (approved_quantity >= 0 and approved_quantity <= quantity),
  restockable boolean,
  created_at timestamptz not null default now(),
  unique (return_id, sale_item_id)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references public.medicines(id),
  batch_id uuid references public.medicine_batches(id),
  kind public.stock_movement_kind not null,
  quantity_delta numeric(12,3) not null,
  quantity_after numeric(12,3),
  reference_type text not null,
  reference_id uuid not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  performed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 2 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.expense_categories(id),
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null default current_date,
  payee text,
  description text not null check (char_length(trim(description)) between 2 and 500),
  payment_method public.payment_method not null default 'cash',
  reference text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles(id) on delete cascade,
  recipient_role public.app_role,
  title text not null,
  message text not null,
  severity text not null default 'info' check (severity in ('info', 'success', 'warning', 'critical')),
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_target_check check (recipient_id is not null or recipient_role is not null)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.pharmacy_settings (
  id boolean primary key default true check (id),
  pharmacy_name text not null default 'Qeilvra Pharmacy',
  address text,
  phone text,
  email text,
  tax_number text,
  currency_code text not null default 'PKR' check (currency_code = 'PKR'),
  timezone text not null default 'Asia/Karachi' check (timezone = 'Asia/Karachi'),
  receipt_footer text not null default 'Thank you for choosing Qeilvra.',
  salesperson_max_discount_percent numeric(5,2) not null default 10 check (salesperson_max_discount_percent between 0 and 100),
  expiry_alert_days integer not null default 60 check (expiry_alert_days between 1 and 730),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.pharmacy_settings (id) values (true);

create index medicines_name_trgm_idx on public.medicines using gin (name extensions.gin_trgm_ops);
create index medicines_generic_trgm_idx on public.medicines using gin (generic_name extensions.gin_trgm_ops);
create index medicines_active_idx on public.medicines (is_active) where is_active;
create index medicine_batches_fefo_idx on public.medicine_batches (medicine_id, expiry_date, created_at)
  where quantity_on_hand > 0 and not is_quarantined;
create index medicine_batches_expiry_idx on public.medicine_batches (expiry_date) where quantity_on_hand > 0;
create index purchases_supplier_date_idx on public.purchases (supplier_id, invoice_date desc);
create index purchase_items_purchase_idx on public.purchase_items (purchase_id);
create index sales_completed_idx on public.sales (completed_at desc);
create index sales_user_completed_idx on public.sales (created_by, completed_at desc);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_medicine_idx on public.sale_items (medicine_id);
create index payments_sale_idx on public.payments (sale_id);
create index returns_sale_idx on public.sale_returns (sale_id, requested_at desc);
create index returns_status_idx on public.sale_returns (status, requested_at desc);
create index stock_movements_medicine_idx on public.stock_movements (medicine_id, created_at desc);
create index expenses_date_idx on public.expenses (expense_date desc);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger user_roles_set_updated_at before update on public.user_roles
for each row execute function public.set_updated_at();
create trigger categories_set_updated_at before update on public.medicine_categories
for each row execute function public.set_updated_at();
create trigger medicines_set_updated_at before update on public.medicines
for each row execute function public.set_updated_at();
create trigger medicine_costs_set_updated_at before update on public.medicine_costs
for each row execute function public.set_updated_at();
create trigger suppliers_set_updated_at before update on public.suppliers
for each row execute function public.set_updated_at();
create trigger purchases_set_updated_at before update on public.purchases
for each row execute function public.set_updated_at();
create trigger batches_set_updated_at before update on public.medicine_batches
for each row execute function public.set_updated_at();
create trigger expense_categories_set_updated_at before update on public.expense_categories
for each row execute function public.set_updated_at();
create trigger expenses_set_updated_at before update on public.expenses
for each row execute function public.set_updated_at();
create trigger settings_set_updated_at before update on public.pharmacy_settings
for each row execute function public.set_updated_at();

commit;
