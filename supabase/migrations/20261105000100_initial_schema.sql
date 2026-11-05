-- Brazil Peptides: Supabase foundation
-- Apply only to a new/empty Supabase project after reviewing this migration.
begin;
create extension if not exists pgcrypto;

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null,
  slug text not null unique,
  short_description text,
  description text,
  uses text,
  evidence text,
  disclaimer text,
  image_url text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.product_categories (
  product_id uuid not null references public.products(id) on delete restrict,
  category_id uuid not null references public.categories(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(product_id, category_id)
);
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  legacy_variant_key text,
  sku text unique,
  name text not null,
  quantity_value numeric(12,3),
  quantity_unit text,
  price numeric(12,2) not null check(price >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, name)
);
create table if not exists public.inventory_balances (
  variant_id uuid primary key references public.product_variants(id) on delete restrict,
  quantity_on_hand integer not null default 0 check(quantity_on_hand >= 0),
  low_stock_threshold integer not null default 3 check(low_stock_threshold >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  movement_type text not null check(movement_type in ('opening_balance','entry','sale','adjustment_in','adjustment_out','return')),
  quantity integer not null check(quantity > 0),
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.affiliates (
  id uuid primary key default gen_random_uuid(),
  legacy_id text not null unique,
  name text not null,
  code text not null unique,
  active boolean not null default true,
  commission_type text not null default 'percent' check(commission_type in ('percent','fixed')),
  commission_value numeric(12,2) not null default 0 check(commission_value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  status text not null default 'pending_payment' check(status in ('pending_payment','paid','processing','completed','cancelled','payment_issue','refunded')),
  payment_status text not null default 'pending' check(payment_status in ('pending','confirmed','rejected','refunded')),
  subtotal numeric(12,2) not null check(subtotal >= 0),
  discount numeric(12,2) not null default 0 check(discount >= 0),
  total numeric(12,2) not null check(total >= 0),
  affiliate_id uuid references public.affiliates(id) on delete set null,
  affiliate_ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(total = round(subtotal - discount, 2))
);
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_name_snapshot text not null,
  variant_name_snapshot text not null,
  sku_snapshot text,
  unit_price numeric(12,2) not null check(unit_price >= 0),
  quantity integer not null check(quantity > 0),
  line_total numeric(12,2) not null check(line_total = round(unit_price * quantity, 2)),
  created_at timestamptz not null default now()
);
create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  previous_status text,
  new_status text not null,
  reason text,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  method text not null check(method in ('pix','transfer','cash','other')),
  amount numeric(12,2) not null check(amount > 0),
  status text not null default 'pending' check(status in ('pending','confirmed','rejected','refunded')),
  payment_reference text,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  base_amount numeric(12,2) not null check(base_amount >= 0),
  commission_amount numeric(12,2) not null check(commission_amount >= 0),
  status text not null default 'pending' check(status in ('pending','approved','paid','cancelled')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists products_active_sort_idx on public.products(active, sort_order);
create index if not exists product_categories_category_idx on public.product_categories(category_id);
create index if not exists variants_product_active_sort_idx on public.product_variants(product_id, active, sort_order);
create index if not exists movements_variant_created_idx on public.inventory_movements(variant_id, created_at desc);
create index if not exists orders_status_created_idx on public.orders(status, created_at desc);
create index if not exists orders_payment_created_idx on public.orders(payment_status, created_at desc);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists payments_order_created_idx on public.payments(order_id, created_at desc);
create index if not exists commissions_status_created_idx on public.affiliate_commissions(status, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;
do $$
declare t text;
begin
  foreach t in array array['site_settings','categories','products','product_variants','affiliates','orders'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.admin_users au where au.user_id = (select auth.uid()) and au.active = true);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.site_settings enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_categories enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.affiliates enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.payments enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.admin_users enable row level security;

revoke all on public.site_settings, public.categories, public.products, public.product_categories,
 public.product_variants, public.inventory_balances, public.inventory_movements, public.affiliates,
 public.orders, public.order_items, public.order_status_history, public.payments,
 public.affiliate_commissions, public.admin_users from anon, authenticated;

grant select on public.categories, public.products, public.product_categories, public.product_variants to anon, authenticated;
grant select on public.site_settings to anon, authenticated;
grant select, insert, update, delete on public.site_settings, public.categories, public.products,
 public.product_categories, public.product_variants, public.inventory_balances, public.inventory_movements,
 public.affiliates, public.orders, public.order_items, public.order_status_history, public.payments,
 public.affiliate_commissions, public.admin_users to authenticated;

drop policy if exists public_site_settings on public.site_settings;
create policy public_site_settings on public.site_settings for select to anon, authenticated using (is_public or (select public.is_admin()));
drop policy if exists public_active_categories on public.categories;
create policy public_active_categories on public.categories for select to anon, authenticated using (active or (select public.is_admin()));
drop policy if exists public_active_products on public.products;
create policy public_active_products on public.products for select to anon, authenticated using (active or (select public.is_admin()));
drop policy if exists public_product_categories on public.product_categories;
create policy public_product_categories on public.product_categories for select to anon, authenticated
 using (exists(select 1 from public.products p where p.id = product_id and p.active) or (select public.is_admin()));
drop policy if exists public_active_variants on public.product_variants;
create policy public_active_variants on public.product_variants for select to anon, authenticated
 using ((active and exists(select 1 from public.products p where p.id = product_id and p.active)) or (select public.is_admin()));

do $$
declare t text;
begin
 foreach t in array array['site_settings','categories','products','product_categories','product_variants',
  'inventory_balances','inventory_movements','affiliates','orders','order_items','order_status_history',
  'payments','affiliate_commissions','admin_users'] loop
  execute format('drop policy if exists admin_all on public.%I', t);
  execute format('create policy admin_all on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
 end loop;
end $$;

revoke all on public.inventory_balances, public.inventory_movements, public.affiliates, public.orders,
 public.order_items, public.order_status_history, public.payments, public.affiliate_commissions, public.admin_users from anon;
commit;
