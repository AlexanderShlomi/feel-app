-- Phase 2 (May 2026): Admin users table + order status management RPC
--
-- Goals:
-- 1) admin_users — simple allowlist table. Only service_role can read it.
--    Authenticated users cannot self-check whether they are admins;
--    the server-side SvelteKit layout guard uses the service role key.
-- 2) admin_update_order_status RPC — security definer, verifies the caller
--    exists in admin_users, restricts valid transitions.
-- 3) orders status check gets a new value 'shipped' + 'delivered'.

-- ── Extend orders status values ───────────────────────────────────────────────
-- Current check: ('pending','paid','processing','cancelled')
-- Add 'shipped' and 'delivered' for the fulfillment pipeline.

alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
    check (status in ('pending','paid','processing','shipped','delivered','cancelled'));

-- ── Admin users table ─────────────────────────────────────────────────────────

create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.admin_users is
  'Simple admin allowlist. Add a row to grant admin access. '
  'Remove the row to revoke. Only service_role can read this table.';

-- Enable RLS so authenticated users cannot read the table directly.
alter table public.admin_users enable row level security;

-- No SELECT policy for authenticated users — service_role bypasses RLS.
-- This prevents a logged-in user from querying "am I an admin?" client-side.

-- ── RPC: is_admin ───────────────────────────────────────────────────────────────
-- Returns true if the current session user is in admin_users.
-- Used by the admin +layout.svelte client-side guard.

create or replace function public.is_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  return exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
end;
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ── RPC: admin_get_orders ─────────────────────────────────────────────────────
-- Returns all orders (bypasses RLS) with item count + first thumbnail.
-- Security definer — checks admin_users before returning data.

create or replace function public.admin_get_orders(
  p_limit  int     default 50,
  p_offset int     default 0,
  p_status text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.admin_users where user_id = auth.uid()) then
    raise exception 'not_admin';
  end if;

  return (
    select coalesce(jsonb_agg(row_data order by row_data->>'placed_at' desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id',                   o.id,
        'order_number',         o.order_number,
        'status',               o.status,
        'placed_at',            o.placed_at,
        'total_amount',         o.total_amount,
        'subtotal_amount',      o.subtotal_amount,
        'shipping_first_name',  o.shipping_first_name,
        'shipping_last_name',   o.shipping_last_name,
        'shipping_city',        o.shipping_city,
        'shipping_street',      o.shipping_street,
        'shipping_house_number',o.shipping_house_number,
        'gift_enabled',         o.gift_enabled,
        'item_count',           (
          select count(*) from public.order_items oi where oi.order_id = o.id
        ),
        'first_thumbnail',      (
          select oi2.thumbnail_url
          from public.order_items oi2
          where oi2.order_id = o.id and oi2.thumbnail_url is not null
          order by oi2.created_at
          limit 1
        )
      ) as row_data
      from public.orders o
      where (p_status is null or o.status = p_status)
      order by o.placed_at desc
      limit  least(p_limit, 100)
      offset p_offset
    ) sub
  );
end;
$$;

revoke all on function public.admin_get_orders(int, int, text) from public;
grant execute on function public.admin_get_orders(int, int, text) to authenticated;

-- ── RPC: admin_get_order_detail ───────────────────────────────────────────────
-- Returns full order + items for admin view.

create or replace function public.admin_get_order_detail(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order jsonb;
  v_items jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.admin_users where user_id = auth.uid()) then
    raise exception 'not_admin';
  end if;

  select to_jsonb(o) into v_order
  from public.orders o
  where o.id = p_order_id;

  if v_order is null then
    raise exception 'order_not_found';
  end if;

  select coalesce(jsonb_agg(to_jsonb(oi) order by oi.created_at), '[]'::jsonb)
  into v_items
  from public.order_items oi
  where oi.order_id = p_order_id;

  return jsonb_build_object(
    'order', v_order,
    'items',  coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_get_order_detail(uuid) from public;
grant execute on function public.admin_get_order_detail(uuid) to authenticated;

-- ── RPC: admin_update_order_status ────────────────────────────────────────────
-- Called from admin server-side routes (SvelteKit +page.server.js) which
-- use the service role key. However, the RPC itself still enforces that the
-- session user is an admin — defence in depth.
--
-- Valid transitions:
--   paid        → processing
--   processing  → shipped
--   shipped     → delivered
--   any (except cancelled/delivered) → cancelled

create or replace function public.admin_update_order_status(
  p_order_id   uuid,
  p_new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status text;
  v_order_number   bigint;
begin
  -- Must be authenticated
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Must be in the admin allowlist
  if not exists (
    select 1 from public.admin_users where user_id = auth.uid()
  ) then
    raise exception 'not_admin';
  end if;

  if p_order_id is null then
    raise exception 'invalid_order_id';
  end if;

  -- Validate target status value
  if p_new_status not in ('processing','shipped','delivered','cancelled') then
    raise exception 'invalid_status_value';
  end if;

  -- Fetch current status
  select o.status, o.order_number
  into v_current_status, v_order_number
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'order_not_found';
  end if;

  -- Validate transition
  if p_new_status = 'processing' and v_current_status <> 'paid' then
    raise exception 'invalid_transition';
  end if;
  if p_new_status = 'shipped' and v_current_status <> 'processing' then
    raise exception 'invalid_transition';
  end if;
  if p_new_status = 'delivered' and v_current_status <> 'shipped' then
    raise exception 'invalid_transition';
  end if;
  if p_new_status = 'cancelled' and v_current_status in ('delivered','cancelled') then
    raise exception 'invalid_transition';
  end if;

  update public.orders
  set    status     = p_new_status,
         updated_at = now()
  where  id = p_order_id;

  raise log 'admin_update_order_status: order_id=% new_status=% admin_uid=%',
    p_order_id, p_new_status, auth.uid();

  return jsonb_build_object(
    'order_id',     p_order_id,
    'order_number', v_order_number,
    'status',       p_new_status
  );
end;
$$;

revoke all on function public.admin_update_order_status(uuid, text) from public;
grant execute on function public.admin_update_order_status(uuid, text) to authenticated;
