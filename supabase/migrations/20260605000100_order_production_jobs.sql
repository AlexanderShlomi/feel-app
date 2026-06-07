-- =============================================================================
-- Shadow Table: order_production_jobs
-- =============================================================================
-- Separates admin production state from customer order data. Admin edits
-- (gift message refinement, replacement images, review status) live here
-- instead of mutating public.orders or public.order_items.
--
-- Key invariants:
--   * 1:1 with orders (order_id is PK + FK).
--   * Created atomically inside create_complete_order.
--   * gift_enabled orders start as 'needs_review'; others as 'ready_for_print'.
--   * admin_get_print_queue only returns 'ready_for_print' jobs.
-- =============================================================================

-- ── Table ────────────────────────────────────────────────────────────────────

create table if not exists public.order_production_jobs (
  order_id                  uuid primary key references public.orders(id) on delete cascade,
  production_status         text not null default 'ready_for_print'
    check (production_status in ('needs_review', 'ready_for_print', 'printed')),
  overridden_gift_message   text,
  overridden_gift_image_path text,
  admin_notes               text,
  processed_by              uuid references auth.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.order_production_jobs is
  'Shadow table for admin production state — never mutate orders/order_items for admin edits.';

create trigger order_production_jobs_set_updated_at
  before update on public.order_production_jobs
  for each row execute function public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.order_production_jobs enable row level security;

create policy "admin_select_production_jobs"
  on public.order_production_jobs for select
  to authenticated
  using (exists (select 1 from public.admin_users where user_id = auth.uid()));

create policy "admin_insert_production_jobs"
  on public.order_production_jobs for insert
  to authenticated
  with check (exists (select 1 from public.admin_users where user_id = auth.uid()));

create policy "admin_update_production_jobs"
  on public.order_production_jobs for update
  to authenticated
  using (exists (select 1 from public.admin_users where user_id = auth.uid()));

-- ── Backfill existing orders ─────────────────────────────────────────────────
-- Orders that already exist need a production job row.

insert into public.order_production_jobs (order_id, production_status)
select
  o.id,
  case when o.gift_enabled then 'needs_review' else 'ready_for_print' end
from public.orders o
where not exists (
  select 1 from public.order_production_jobs pj where pj.order_id = o.id
)
on conflict (order_id) do nothing;

-- ── Update create_complete_order to insert production job ────────────────────

drop function if exists public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric);

create function public.create_complete_order(
  p_order_id uuid,
  p_shipping_data jsonb,
  p_gift_data jsonb,
  p_items jsonb,
  p_subtotal numeric,
  p_total numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_name             constant int := 80;
  c_max_city_or_street   constant int := 120;
  c_max_notes            constant int := 1000;
  c_max_gift_message     constant int := 1000;
  c_max_phone            constant int := 32;
  c_max_coupon           constant int := 64;
  c_max_item_title       constant int := 200;
  c_max_item_subtitle    constant int := 300;

  v_user uuid := auth.uid();
  v_item_ids uuid[] := array[]::uuid[];
  v_units numeric[] := array[]::numeric[];
  v_qtys integer[] := array[]::integer[];
  v_id uuid;
  i integer;
  el jsonb;
  v_len integer;
  v_qty integer;
  v_unit numeric;
  v_line numeric;
  v_subtotal numeric := 0;
  v_cfg_text text;
  v_order_number bigint;

  v_first_name text;
  v_last_name text;
  v_city text;
  v_street text;
  v_notes text;
  v_house_num int;
  v_apt_num int;
  v_coupon text;
  v_gift_enabled boolean;
  v_gift_message text;
  v_gift_sender_name text;
  v_gift_sender_phone text;

  v_existing_user uuid;
  v_existing_subtotal numeric;
  v_existing_total numeric;
  v_existing_number bigint;
begin
  if v_user is null then
    raise log 'create_complete_order: not_authenticated (order_id=%)', p_order_id;
    raise exception 'not_authenticated';
  end if;

  -- Idempotent fast-path
  select o.user_id, o.subtotal_amount, o.total_amount, o.order_number
  into v_existing_user, v_existing_subtotal, v_existing_total, v_existing_number
  from public.orders o
  where o.id = p_order_id;

  if found then
    if v_existing_user is distinct from v_user then
      raise log 'create_complete_order: order_id_taken (order_id=%, by=%, request_user=%)',
        p_order_id, v_existing_user, v_user;
      raise exception 'order_id_taken';
    end if;

    select coalesce(array_agg(oi.id order by oi.created_at), array[]::uuid[])
    into v_item_ids
    from public.order_items oi
    where oi.order_id = p_order_id;

    return jsonb_build_object(
      'order_id', p_order_id,
      'order_number', v_existing_number,
      'item_ids', to_jsonb(v_item_ids),
      'subtotal', v_existing_subtotal,
      'total', v_existing_total
    );
  end if;

  -- Items validation + server-authoritative pricing
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise log 'create_complete_order: invalid_items (order_id=%, user=%)', p_order_id, v_user;
    raise exception 'invalid_items';
  end if;

  v_len := coalesce(jsonb_array_length(p_items), 0);
  if v_len < 1 then
    raise log 'create_complete_order: empty_items (order_id=%, user=%)', p_order_id, v_user;
    raise exception 'empty_items';
  end if;

  for i in 0 .. v_len - 1 loop
    el := p_items -> i;

    v_qty := coalesce(nullif(el ->> 'quantity', '')::integer, 1);
    if v_qty < 1 then
      raise log 'create_complete_order: invalid_quantity (order_id=%, user=%, idx=%)', p_order_id, v_user, i;
      raise exception 'invalid_quantity';
    end if;

    v_cfg_text := (coalesce(el -> 'configuration', '{}'::jsonb))::text;
    if octet_length(v_cfg_text) > 51200 then
      raise log 'create_complete_order: configuration_too_large (order_id=%, user=%, idx=%, bytes=%)',
        p_order_id, v_user, i, octet_length(v_cfg_text);
      raise exception 'configuration_too_large';
    end if;
    if position('data:image' in lower(v_cfg_text)) > 0 then
      raise log 'create_complete_order: configuration_contains_data_image (order_id=%, user=%, idx=%)',
        p_order_id, v_user, i;
      raise exception 'configuration_contains_data_image';
    end if;

    if char_length(coalesce(el ->> 'title', '')) > c_max_item_title then
      raise log 'create_complete_order: item_title_too_long (order_id=%, user=%, idx=%)', p_order_id, v_user, i;
      raise exception 'item_title_too_long';
    end if;
    if char_length(coalesce(el ->> 'subtitle', '')) > c_max_item_subtitle then
      raise log 'create_complete_order: item_subtitle_too_long (order_id=%, user=%, idx=%)', p_order_id, v_user, i;
      raise exception 'item_subtitle_too_long';
    end if;

    v_unit := public.compute_order_item_unit_price(
      nullif(el ->> 'type', ''),
      coalesce(el -> 'configuration', '{}'::jsonb)
    );
    if v_unit < 0 then
      raise log 'create_complete_order: invalid_price (order_id=%, user=%, idx=%)', p_order_id, v_user, i;
      raise exception 'invalid_price';
    end if;

    v_line := v_unit * v_qty;
    v_subtotal := v_subtotal + v_line;

    v_units := array_append(v_units, v_unit);
    v_qtys := array_append(v_qtys, v_qty);
  end loop;

  if p_subtotal is not null and abs(p_subtotal - v_subtotal) > 0.01 then
    raise log 'create_complete_order: client_subtotal_mismatch (order_id=%, user=%, client=%, server=%)',
      p_order_id, v_user, p_subtotal, v_subtotal;
    raise exception 'client_subtotal_mismatch';
  end if;
  if p_total is not null and abs(p_total - v_subtotal) > 0.01 then
    raise log 'create_complete_order: client_total_mismatch (order_id=%, user=%, client=%, server=%)',
      p_order_id, v_user, p_total, v_subtotal;
    raise exception 'client_total_mismatch';
  end if;

  -- Sanitize + length-cap shipping/gift inputs
  v_first_name        := public.feel_sanitize_text(p_shipping_data->>'firstName');
  v_last_name         := public.feel_sanitize_text(p_shipping_data->>'lastName');
  v_city              := public.feel_sanitize_text(p_shipping_data->>'city');
  v_street            := public.feel_sanitize_text(p_shipping_data->>'street');
  v_notes             := public.feel_sanitize_text(p_shipping_data->>'notes');
  v_coupon            := public.feel_sanitize_text(p_shipping_data->>'couponCode');
  v_gift_enabled      := coalesce((p_gift_data->>'enabled')::boolean, false);
  v_gift_message      := public.feel_sanitize_text(p_gift_data->>'message');
  v_gift_sender_name  := public.feel_sanitize_text(p_gift_data->>'senderName');
  v_gift_sender_phone := public.feel_sanitize_text(p_gift_data->>'senderPhone');

  if v_first_name is null then
    raise log 'create_complete_order: shipping_first_name_required (order_id=%, user=%)', p_order_id, v_user;
    raise exception 'shipping_first_name_required';
  end if;
  if v_last_name is null then
    raise log 'create_complete_order: shipping_last_name_required (order_id=%, user=%)', p_order_id, v_user;
    raise exception 'shipping_last_name_required';
  end if;
  if v_city is null then
    raise log 'create_complete_order: shipping_city_required (order_id=%, user=%)', p_order_id, v_user;
    raise exception 'shipping_city_required';
  end if;
  if v_street is null then
    raise log 'create_complete_order: shipping_street_required (order_id=%, user=%)', p_order_id, v_user;
    raise exception 'shipping_street_required';
  end if;

  if char_length(v_first_name) > c_max_name then raise exception 'shipping_first_name_too_long'; end if;
  if char_length(v_last_name)  > c_max_name then raise exception 'shipping_last_name_too_long';  end if;
  if char_length(v_city)       > c_max_city_or_street then raise exception 'shipping_city_too_long'; end if;
  if char_length(v_street)     > c_max_city_or_street then raise exception 'shipping_street_too_long'; end if;
  if v_notes is not null and char_length(v_notes) > c_max_notes then
    raise exception 'shipping_notes_too_long';
  end if;
  if v_coupon is not null and char_length(v_coupon) > c_max_coupon then
    raise exception 'coupon_code_too_long';
  end if;
  if v_gift_message is not null and char_length(v_gift_message) > c_max_gift_message then
    raise exception 'gift_message_too_long';
  end if;
  if v_gift_sender_name is not null and char_length(v_gift_sender_name) > c_max_name then
    raise exception 'gift_sender_name_too_long';
  end if;
  if v_gift_sender_phone is not null and char_length(v_gift_sender_phone) > c_max_phone then
    raise exception 'gift_sender_phone_too_long';
  end if;

  v_house_num := nullif(p_shipping_data->>'houseNum', '')::integer;
  v_apt_num   := nullif(p_shipping_data->>'aptNum', '')::integer;
  if v_house_num is null then
    raise log 'create_complete_order: shipping_house_number_required (order_id=%, user=%)', p_order_id, v_user;
    raise exception 'shipping_house_number_required';
  end if;
  if v_house_num < 0 or v_house_num > 100000 then
    raise exception 'shipping_house_number_invalid';
  end if;
  if v_apt_num is not null and (v_apt_num < 0 or v_apt_num > 100000) then
    raise exception 'shipping_apartment_number_invalid';
  end if;

  -- Insert the order
  insert into public.orders (
    id, user_id, status, currency, coupon_code, discount_amount,
    shipping_method, shipping_amount, subtotal_amount, total_amount,
    shipping_first_name, shipping_last_name, shipping_city, shipping_street,
    shipping_house_number, shipping_apartment_number, shipping_notes,
    gift_enabled, gift_message, gift_sender_name, gift_sender_phone
  ) values (
    p_order_id, v_user, 'pending', 'ILS', v_coupon, 0,
    'home_delivery_free', 0, v_subtotal, v_subtotal,
    v_first_name, v_last_name, v_city, v_street,
    v_house_num, v_apt_num, v_notes,
    v_gift_enabled, v_gift_message, v_gift_sender_name, v_gift_sender_phone
  )
  on conflict (id) do nothing
  returning order_number into v_order_number;

  if v_order_number is null then
    select o.user_id, o.subtotal_amount, o.total_amount, o.order_number
    into v_existing_user, v_existing_subtotal, v_existing_total, v_existing_number
    from public.orders o
    where o.id = p_order_id;

    if not found or v_existing_user is distinct from v_user then
      raise log 'create_complete_order: order_id_taken_post_insert (order_id=%, user=%)', p_order_id, v_user;
      raise exception 'order_id_taken';
    end if;

    select coalesce(array_agg(oi.id order by oi.created_at), array[]::uuid[])
    into v_item_ids
    from public.order_items oi
    where oi.order_id = p_order_id;

    return jsonb_build_object(
      'order_id', p_order_id,
      'order_number', v_existing_number,
      'item_ids', to_jsonb(v_item_ids),
      'subtotal', v_existing_subtotal,
      'total', v_existing_total
    );
  end if;

  -- Insert production job (shadow table)
  insert into public.order_production_jobs (order_id, production_status)
  values (
    p_order_id,
    case when v_gift_enabled then 'needs_review' else 'ready_for_print' end
  )
  on conflict (order_id) do nothing;

  -- Items insert pass
  for i in 0 .. v_len - 1 loop
    el := p_items -> i;

    insert into public.order_items (
      order_id, item_type, title, subtitle,
      unit_price, quantity, line_total, configuration, thumbnail_url
    )
    values (
      p_order_id,
      nullif(el ->> 'type', ''),
      coalesce(public.feel_sanitize_text(el ->> 'title'), ''),
      public.feel_sanitize_text(el ->> 'subtitle'),
      v_units[i + 1], v_qtys[i + 1], v_units[i + 1] * v_qtys[i + 1],
      coalesce(el -> 'configuration', '{}'::jsonb),
      nullif(trim(coalesce(el ->> 'thumbnail_url', '')), '')
    )
    returning id into v_id;

    v_item_ids := array_append(v_item_ids, v_id);
  end loop;

  return jsonb_build_object(
    'order_id', p_order_id,
    'order_number', v_order_number,
    'item_ids', to_jsonb(v_item_ids),
    'subtotal', v_subtotal,
    'total', v_subtotal
  );

exception
  when others then
    raise log 'create_complete_order: unhandled exception (order_id=%, user=%, sqlstate=%, msg=%)',
      p_order_id, v_user, sqlstate, sqlerrm;
    raise;
end;
$$;

revoke all on function public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) from public;
grant execute on function public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) to authenticated;

-- ── Update admin_get_order_detail to include production job ──────────────────

create or replace function public.admin_get_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order jsonb;
  v_items jsonb;
  v_production_job jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.admin_users where user_id = auth.uid()) then
    raise exception 'not_admin';
  end if;

  select to_jsonb(o.*) into v_order
  from public.orders o
  where o.id = p_order_id;

  if v_order is null then
    raise exception 'order_not_found';
  end if;

  select coalesce(jsonb_agg(to_jsonb(oi.*) order by oi.created_at), '[]'::jsonb)
  into v_items
  from public.order_items oi
  where oi.order_id = p_order_id;

  select to_jsonb(pj.*) into v_production_job
  from public.order_production_jobs pj
  where pj.order_id = p_order_id;

  return jsonb_build_object(
    'order', v_order,
    'items', v_items,
    'production_job', coalesce(v_production_job, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.admin_get_order_detail(uuid) from public;
grant execute on function public.admin_get_order_detail(uuid) to authenticated;

-- ── Update admin_get_print_queue to filter by production_status ──────────────

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
        'production_status',    pj.production_status,
        'visible_tile_count',   (
          select coalesce(sum(
            case
              when oi.item_type = 'mosaic' then
                power(coalesce((oi.configuration->'settingsMeta'->>'gridBaseSize')::int, 3), 2)::int
              else
                (
                  select count(*)
                  from jsonb_array_elements(coalesce(oi.configuration->'magnetsMeta', '[]'::jsonb)) elem
                  where (elem->>'hidden')::boolean is distinct from true
                )
            end
          ), 0)::int
          from public.order_items oi
          where oi.order_id = o.id
            and oi.item_type is distinct from 'gift'
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
            and oi2.item_type is distinct from 'gift'
        )
      ) as row_data
      from public.orders o
      inner join public.order_production_jobs pj on pj.order_id = o.id
      where o.status in ('paid', 'processing')
        and pj.production_status = 'ready_for_print'
      order by o.placed_at asc
    ) sub
  );
end;
$$;

revoke all on function public.admin_get_print_queue() from public;
grant execute on function public.admin_get_print_queue() to authenticated;

-- ── RPC: admin_update_production_job ─────────────────────────────────────────
-- Updates the shadow table fields. Used by the order detail admin UI.

create or replace function public.admin_update_production_job(
  p_order_id uuid,
  p_production_status text default null,
  p_overridden_gift_message text default null,
  p_overridden_gift_image_path text default null,
  p_admin_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_current_status text;
begin
  if v_admin is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.admin_users where user_id = v_admin) then
    raise exception 'not_admin';
  end if;

  select pj.production_status into v_current_status
  from public.order_production_jobs pj
  where pj.order_id = p_order_id;

  if not found then
    raise exception 'production_job_not_found';
  end if;

  if p_production_status is not null then
    if p_production_status not in ('needs_review', 'ready_for_print', 'printed') then
      raise exception 'invalid_production_status';
    end if;
    if v_current_status = 'printed' and p_production_status <> 'printed' then
      raise exception 'cannot_revert_printed';
    end if;
  end if;

  update public.order_production_jobs
  set
    production_status         = coalesce(p_production_status, production_status),
    overridden_gift_message   = case when p_overridden_gift_message is not null
                                     then public.feel_sanitize_text(p_overridden_gift_message)
                                     else overridden_gift_message end,
    overridden_gift_image_path = coalesce(p_overridden_gift_image_path, overridden_gift_image_path),
    admin_notes               = case when p_admin_notes is not null
                                     then public.feel_sanitize_text(p_admin_notes)
                                     else admin_notes end,
    processed_by              = v_admin
  where order_id = p_order_id;

  raise log 'admin_update_production_job: order_id=% status=% admin=%',
    p_order_id, coalesce(p_production_status, v_current_status), v_admin;

  return (
    select to_jsonb(pj.*)
    from public.order_production_jobs pj
    where pj.order_id = p_order_id
  );
end;
$$;

revoke all on function public.admin_update_production_job(uuid, text, text, text, text) from public;
grant execute on function public.admin_update_production_job(uuid, text, text, text, text) to authenticated;

-- ── Update admin_get_print_originals to include overridden gift data ─────────

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
        'gift_enabled',           o.gift_enabled,
        'gift_message',           coalesce(pj.overridden_gift_message, o.gift_message),
        'gift_image_path',        pj.overridden_gift_image_path,
        'item_id',                oi.id,
        'item_type',              oi.item_type,
        'configuration',          oi.configuration,
        'original_storage_paths', oi.original_storage_paths
      ) as row_data
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      left join public.order_production_jobs pj on pj.order_id = o.id
      where o.id = any(p_order_ids)
      order by o.placed_at asc, oi.created_at asc
    ) sub
  );
end;
$$;

revoke all on function public.admin_get_print_originals(uuid[]) from public;
grant execute on function public.admin_get_print_originals(uuid[]) to authenticated;

-- ── Update admin_mark_orders_printed to also mark production_status ──────────

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

  update public.orders
  set status = 'processing'
  where id = any(p_order_ids)
    and status = 'paid';

  update public.orders
  set printed_at = now()
  where id = any(p_order_ids)
    and printed_at is null;

  update public.order_production_jobs
  set production_status = 'printed',
      processed_by = auth.uid()
  where order_id = any(p_order_ids)
    and production_status = 'ready_for_print';

  get diagnostics v_updated = row_count;

  return jsonb_build_object('updated', v_updated);
end;
$$;

revoke all on function public.admin_mark_orders_printed(uuid[]) from public;
grant execute on function public.admin_mark_orders_printed(uuid[]) to authenticated;
