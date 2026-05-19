-- =============================================================================
-- Admin print pipeline — column + RPCs for batch print workflow
-- =============================================================================
-- Goals:
--   1) Add printed_at column to orders (nullable).
--   2) admin_get_print_queue — returns printable orders (paid/processing).
--   3) admin_get_print_originals — signed URLs for selected orders' originals.
--   4) admin_mark_orders_printed — stamps printed_at, transitions paid→processing.
-- =============================================================================

-- ── Column ────────────────────────────────────────────────────────────────────

alter table public.orders
  add column if not exists printed_at timestamptz default null;

comment on column public.orders.printed_at is
  'Timestamp when this order was physically printed via admin print workflow. NULL = not yet printed.';

-- ── RPC: admin_get_print_queue ────────────────────────────────────────────────
-- Returns orders eligible for printing (paid / processing), ordered by placed_at ASC.
-- Each row includes a summary of visible magnet/mosaic tile count per item.

create or replace function public.admin_get_print_queue()
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
    select coalesce(jsonb_agg(row_data order by (row_data->>'placed_at')::timestamptz asc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id',                   o.id,
        'order_number',         o.order_number,
        'status',               o.status,
        'placed_at',            o.placed_at,
        'printed_at',           o.printed_at,
        'shipping_first_name',  o.shipping_first_name,
        'shipping_last_name',   o.shipping_last_name,
        'visible_tile_count',   (
          select coalesce(sum(
            case
              when oi.item_type = 'mosaic' then
                power(coalesce((oi.configuration->'settingsMeta'->>'gridBaseSize')::int, 3), 2)::int
              else
                -- magnets_pack: count non-hidden entries in magnetsMeta
                (
                  select count(*)
                  from jsonb_array_elements(coalesce(oi.configuration->'magnetsMeta', '[]'::jsonb)) elem
                  where (elem->>'hidden')::boolean is distinct from true
                )
            end
          ), 0)::int
          from public.order_items oi
          where oi.order_id = o.id
        ),
        'items_summary',        (
          select coalesce(jsonb_agg(jsonb_build_object(
            'item_id',        oi2.id,
            'item_type',      oi2.item_type,
            'visible_count',  case
              when oi2.item_type = 'mosaic' then
                power(coalesce((oi2.configuration->'settingsMeta'->>'gridBaseSize')::int, 3), 2)::int
              else
                (
                  select count(*)::int
                  from jsonb_array_elements(coalesce(oi2.configuration->'magnetsMeta', '[]'::jsonb)) elem2
                  where (elem2->>'hidden')::boolean is distinct from true
                )
            end
          )), '[]'::jsonb)
          from public.order_items oi2
          where oi2.order_id = o.id
        )
      ) as row_data
      from public.orders o
      where o.status in ('paid', 'processing')
      order by o.placed_at asc
    ) sub
  );
end;
$$;

revoke all on function public.admin_get_print_queue() from public;
grant execute on function public.admin_get_print_queue() to authenticated;

-- ── RPC: admin_get_print_originals ────────────────────────────────────────────
-- Given an array of order IDs, returns all original image info needed for print.
-- Caller is responsible for creating signed URLs client-side (admin uses supabase client).
-- We return storage paths + crop metadata so the client renders correctly.

create or replace function public.admin_get_print_originals(
  p_order_ids uuid[]
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

  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(jsonb_agg(row_data), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'order_id',               o.id,
        'order_number',           o.order_number,
        'shipping_first_name',    o.shipping_first_name,
        'shipping_last_name',     o.shipping_last_name,
        'item_id',                oi.id,
        'item_type',              oi.item_type,
        'configuration',          oi.configuration,
        'original_storage_paths', oi.original_storage_paths
      ) as row_data
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      where o.id = any(p_order_ids)
      order by o.placed_at asc, oi.created_at asc
    ) sub
  );
end;
$$;

revoke all on function public.admin_get_print_originals(uuid[]) from public;
grant execute on function public.admin_get_print_originals(uuid[]) to authenticated;

-- ── RPC: admin_mark_orders_printed ────────────────────────────────────────────
-- Stamps printed_at = now() and transitions paid→processing where applicable.

create or replace function public.admin_mark_orders_printed(
  p_order_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.admin_users where user_id = auth.uid()) then
    raise exception 'not_admin';
  end if;

  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    return jsonb_build_object('updated', 0);
  end if;

  -- Transition paid → processing
  update public.orders
  set status = 'processing'
  where id = any(p_order_ids)
    and status = 'paid';

  -- Stamp printed_at on all selected orders (regardless of status)
  update public.orders
  set printed_at = now()
  where id = any(p_order_ids)
    and printed_at is null;

  get diagnostics v_updated = row_count;

  return jsonb_build_object('updated', v_updated);
end;
$$;

revoke all on function public.admin_mark_orders_printed(uuid[]) from public;
grant execute on function public.admin_mark_orders_printed(uuid[]) to authenticated;
