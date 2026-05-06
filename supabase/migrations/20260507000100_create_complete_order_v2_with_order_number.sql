-- Stabilization Sprint v2 (May 2026):
--
-- Goals:
-- 1) Return order_number directly from create_complete_order
--    so the client can render the payment screen without a second
--    select('order_number') round-trip.
-- 2) Single-pass items loop: validate guardrail, compute price,
--    cache unit/qty in arrays, then INSERT items in the same pass.
--    Removes the duplicated work from the 20260411120000 version.
-- 3) Same security/authority guarantees:
--    * Server-authoritative pricing via compute_order_item_unit_price
--    * Tamper detection on client subtotal/total
--    * 50KB configuration guardrail + data:image rejection
--    * RLS protected; security definer with explicit search_path
--
-- Behavior is backward compatible with v1:
--   * Same function signature.
--   * Returns the same fields plus 'order_number'.

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
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items';
  end if;

  v_len := coalesce(jsonb_array_length(p_items), 0);
  if v_len < 1 then
    raise exception 'empty_items';
  end if;

  -- Single pass: validate, compute, accumulate. Cache values for the second insert pass.
  for i in 0 .. v_len - 1 loop
    el := p_items -> i;

    v_qty := coalesce(nullif(el ->> 'quantity', '')::integer, 1);
    if v_qty < 1 then
      raise exception 'invalid_quantity';
    end if;

    v_cfg_text := (coalesce(el -> 'configuration', '{}'::jsonb))::text;
    if octet_length(v_cfg_text) > 51200 then
      raise exception 'configuration_too_large';
    end if;
    if position('data:image' in lower(v_cfg_text)) > 0 then
      raise exception 'configuration_contains_data_image';
    end if;

    v_unit := public.compute_order_item_unit_price(
      nullif(el ->> 'type', ''),
      coalesce(el -> 'configuration', '{}'::jsonb)
    );
    if v_unit < 0 then
      raise exception 'invalid_price';
    end if;

    v_line := v_unit * v_qty;
    v_subtotal := v_subtotal + v_line;

    v_units := array_append(v_units, v_unit);
    v_qtys := array_append(v_qtys, v_qty);
  end loop;

  -- Tamper detection (client may submit estimates; server is authoritative).
  if p_subtotal is not null and abs(p_subtotal - v_subtotal) > 0.01 then
    raise exception 'client_subtotal_mismatch';
  end if;
  if p_total is not null and abs(p_total - v_subtotal) > 0.01 then
    raise exception 'client_total_mismatch';
  end if;

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
    auth.uid(),
    'pending',
    'ILS',
    nullif(p_shipping_data->>'couponCode', ''),
    0,
    'home_delivery_free',
    0,
    v_subtotal,
    v_subtotal,
    p_shipping_data->>'firstName',
    p_shipping_data->>'lastName',
    p_shipping_data->>'city',
    p_shipping_data->>'street',
    (p_shipping_data->>'houseNum')::integer,
    nullif(p_shipping_data->>'aptNum', '')::integer,
    nullif(p_shipping_data->>'notes', ''),
    coalesce((p_gift_data->>'enabled')::boolean, false),
    nullif(p_gift_data->>'message', ''),
    nullif(p_gift_data->>'senderName', ''),
    nullif(p_gift_data->>'senderPhone', '')
  )
  returning order_number into v_order_number;

  -- Insert items using the cached unit prices.
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
      coalesce(el ->> 'title', ''),
      nullif(el ->> 'subtitle', ''),
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
end;
$$;

revoke all on function public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) from public;
grant execute on function public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) to authenticated;
