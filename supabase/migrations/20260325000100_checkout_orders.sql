-- Orders + Order Items for Checkout (demo payment flow)
-- Step 1: create tables

create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete cascade,

  -- Default status per requirements
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'processing', 'cancelled')),

  -- Monetary snapshot
  currency text not null default 'ILS',
  coupon_code text,
  discount_amount numeric(12,2) not null default 0,

  shipping_method text not null default 'home_delivery_free',
  shipping_amount numeric(12,2) not null default 0,

  subtotal_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,

  -- Shipping (required by UI)
  shipping_first_name text not null,
  shipping_last_name text not null,
  shipping_city text not null,
  shipping_street text not null,
  shipping_house_number integer not null,
  shipping_apartment_number integer,
  shipping_notes text,

  -- Gift (optional via toggle)
  gift_enabled boolean not null default false,
  gift_message text,
  gift_sender_name text,
  gift_sender_phone text,

  placed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_user_id_created_at_idx
  on public.orders (user_id, created_at desc);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,

  item_type text,
  title text,
  subtitle text,
  unit_price numeric(12,2) not null default 0,
  quantity integer not null default 1,
  line_total numeric(12,2) not null default 0,

  -- Step 2 requirement: full cart snapshot per item
  configuration jsonb not null,

  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

-- RLS (frontend will insert/update only for the current authenticated user)
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists orders_insert_own on public.orders;
create policy orders_insert_own
on public.orders
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own
on public.orders
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists orders_update_own on public.orders;
create policy orders_update_own
on public.orders
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists order_items_insert_own on public.order_items;
create policy order_items_insert_own
on public.order_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.orders o
    where o.id = order_id
      and o.user_id = auth.uid()
  )
);

drop policy if exists order_items_select_own on public.order_items;
create policy order_items_select_own
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_id
      and o.user_id = auth.uid()
  )
);

