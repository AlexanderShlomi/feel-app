-- Stabilization Sprint v3 (May 2026): infrastructure hardening
--
-- Builds on top of v2 (20260507000100). All goals from v2 still hold:
--   * Server-authoritative pricing via compute_order_item_unit_price
--   * Tamper detection on subtotal/total
--   * 50KB configuration guardrail + data:image rejection
--   * Returns order_number directly (no second round-trip)
--
-- New in v3:
--   1) Length caps on every shipping/gift/item text input (defense-in-depth
--      so a malicious or buggy client cannot persist 10,000-char strings).
--   2) Control-character / NULL-byte sanitization on free-form text — keeps
--      Postgres logs clean, prevents UI rendering glitches and a class of
--      injection-style bugs in downstream consumers (PDF, email).
--   3) Idempotent recovery: if create_complete_order is called twice with
--      the same p_order_id by the same user, the second call returns the
--      existing order's shape instead of raising unique_violation. This
--      makes the RPC itself idempotent — the client wrapper still has its
--      own recovery layer, but we no longer rely on it.
--   4) Structured `raise log` lines before every `raise exception` so
--      Supabase Postgres logs surface failures with order_id + user_id
--      context for triage.
--
-- Backward compatibility:
--   * Same signature: (uuid, jsonb, jsonb, jsonb, numeric, numeric) → jsonb.
--   * Same return shape: { order_id, order_number, item_ids, subtotal, total }.
--   * Same exception names — clients matching on err.message still work.

-- Sanitization helper: strip ASCII control characters except TAB (\t),
-- LF (\n), CR (\r). Also collapses NULL bytes that Postgres rejects in TEXT
-- columns. Returns null when the input collapses to empty.
create or replace function public.feel_sanitize_text(p_input text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_clean text;
begin
  if p_input is null then
    return null;
  end if;

  -- Drop NULL bytes outright (Postgres TEXT doesn't allow them anyway).
  v_clean := replace(p_input, chr(0), '');

  -- Drop other C0 control chars except TAB/LF/CR (regex class is ASCII-aware
  -- because the inputs are validated upstream as plain text fields).
  v_clean := regexp_replace(v_clean, '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');

  -- Trim surrounding whitespace; collapse to NULL when empty so we keep
  -- existing nullif(...) semantics across the function.
  v_clean := nullif(btrim(v_clean), '');
  return v_clean;
end;
$$;

revoke all on function public.feel_sanitize_text(text) from public;
grant execute on function public.feel_sanitize_text(text) to authenticated;

-- Drop the v2 binding so the new body replaces it cleanly.
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
  -- ---- input length caps (TEXT columns only — numeric columns are bounded
  -- by their own type). Tuned for plausible Hebrew names + addresses; bumping
  -- these requires an audit of /orders rendering and the email template.
  c_max_name             constant int := 80;
  c_max_city_or_street   constant int := 120;
  c_max_notes            constant int := 1000;
  c_max_gift_message     constant int := 1000;
  c_max_phone            constant int := 32;
  c_max_coupon           constant int := 64;
  c_max_item_title       constant int := 200;
  c_max_item_subtitle    constant int := 300;

  -- ---- working state
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

  -- sanitized scalars (kept around for both inserts + idempotent path)
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

  -- ----------------------------------------------------------
  -- Idempotent fast-path: if the same caller already committed
  -- this order id, return its shape and exit. This makes the
  -- RPC itself idempotent so a retry after a lost reply does
  -- not raise unique_violation.
  -- ----------------------------------------------------------
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

    -- Same user, same id → return existing items + totals.
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

  -- ----------------------------------------------------------
  -- Items validation + server-authoritative pricing.
  -- ----------------------------------------------------------
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

    -- Item text caps. Use char_length so we count Unicode characters, not bytes.
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

  -- ----------------------------------------------------------
  -- Sanitize + length-cap shipping/gift inputs.
  -- ----------------------------------------------------------
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

  -- ----------------------------------------------------------
  -- Insert the order. We use ON CONFLICT DO NOTHING to handle
  -- the (rare) race where another concurrent call committed
  -- between our existence check and this insert. If nothing was
  -- inserted, fall back to the idempotent recovery path.
  -- ----------------------------------------------------------
  insert into public.orders (
    id,
    user_id,
    status,
    currency,
    coupon_code,
    discount_amount,
    shipping_method,
    shipping_amount,
    subtotal_amount,
    total_amount,
    shipping_first_name,
    shipping_last_name,
    shipping_city,
    shipping_street,
    shipping_house_number,
    shipping_apartment_number,
    shipping_notes,
    gift_enabled,
    gift_message,
    gift_sender_name,
    gift_sender_phone
  ) values (
    p_order_id,
    v_user,
    'pending',
    'ILS',
    v_coupon,
    0,
    'home_delivery_free',
    0,
    v_subtotal,
    v_subtotal,
    v_first_name,
    v_last_name,
    v_city,
    v_street,
    v_house_num,
    v_apt_num,
    v_notes,
    v_gift_enabled,
    v_gift_message,
    v_gift_sender_name,
    v_gift_sender_phone
  )
  on conflict (id) do nothing
  returning order_number into v_order_number;

  if v_order_number is null then
    -- Race recovery: someone else (us, retried) committed between checks.
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

  -- Items insert pass — uses cached unit prices and quantities.
  for i in 0 .. v_len - 1 loop
    el := p_items -> i;

    insert into public.order_items (
      order_id,
      item_type,
      title,
      subtitle,
      unit_price,
      quantity,
      line_total,
      configuration,
      thumbnail_url
    )
    values (
      p_order_id,
      nullif(el ->> 'type', ''),
      coalesce(public.feel_sanitize_text(el ->> 'title'), ''),
      public.feel_sanitize_text(el ->> 'subtitle'),
      v_units[i + 1],
      v_qtys[i + 1],
      v_units[i + 1] * v_qtys[i + 1],
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
  -- Catch-all so we always emit a structured server log line for any
  -- unexpected failure during the transaction. Re-raise so the client
  -- still sees the original error code/message.
  when others then
    raise log 'create_complete_order: unhandled exception (order_id=%, user=%, sqlstate=%, msg=%)',
      p_order_id, v_user, sqlstate, sqlerrm;
    raise;
end;
$$;

revoke all on function public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) from public;
grant execute on function public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) to authenticated;
