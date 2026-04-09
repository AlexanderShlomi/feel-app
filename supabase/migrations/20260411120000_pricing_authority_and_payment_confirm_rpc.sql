-- Stabilization Sprint (P0): server-authoritative pricing + locked status transitions
--
-- Goals:
-- 1) create_complete_order computes prices/totals on the server (client prices are ignored/validated)
-- 2) Prevent direct client updates to orders.status (and orders updates in general)
-- 3) Provide confirm_order_payment RPC for controlled status transition

-- Helper: compute server-side unit price from item type + configuration.
create or replace function public.compute_order_item_unit_price(
  p_item_type text,
  p_configuration jsonb
)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_type text := coalesce(nullif(trim(p_item_type), ''), '');
  v_count int := 0;
begin
  -- count is expected to be present in configuration built by the checkout (buildOrderItemConfiguration),
  -- but we keep a few fallbacks for robustness.
  begin
    v_count := coalesce(nullif(p_configuration->>'count','')::int, nullif(p_configuration->>'qty','')::int, 0);
  exception when others then
    v_count := 0;
  end;

  if v_type = 'gift' then
    return 0;
  end if;

  if v_type = 'magnets_pack' then
    -- Pricing rules mirrored from frontend (src/lib/stores.js):
    -- packages: 9=119, 12=139, 15=159, 24=239, 30=289; extra magnet: 10
    if v_count < 9 then
      raise exception 'invalid_item_count';
    end if;
    if v_count >= 30 then return 289 + ((v_count - 30) * 10); end if;
    if v_count >= 24 then return 239 + ((v_count - 24) * 10); end if;
    if v_count >= 15 then return 159 + ((v_count - 15) * 10); end if;
    if v_count >= 12 then return 139 + ((v_count - 12) * 10); end if;
    return 119 + ((v_count - 9) * 10);
  end if;

  if v_type = 'mosaic' then
    -- Mosaic: base 9=119 + extra * 10
    if v_count < 9 then
      raise exception 'invalid_item_count';
    end if;
    return 119 + (greatest(0, v_count - 9) * 10);
  end if;

  raise exception 'unknown_item_type';
end;
$$;

-- Replace create_complete_order: compute prices/totals on server, return item ids for thumbnail backfill.
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
  v_id uuid;
  i integer;
  el jsonb;
  v_len integer;
  v_qty integer;
  v_unit numeric;
  v_line numeric;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_cfg_text text;
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

  -- First pass: compute prices and totals server-side.
  for i in 0 .. v_len - 1 loop
    el := p_items -> i;
    v_qty := coalesce(nullif(el ->> 'quantity', '')::integer, 1);
    if v_qty < 1 then
      raise exception 'invalid_quantity';
    end if;

    -- Guardrail: reject embedded images or huge configuration blobs (50KB).
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
  end loop;

  -- Currently: no discounts/shipping logic in backend; keep deterministic totals.
  v_total := v_subtotal;

  -- Optional tamper detection: if the client supplied totals and they don't match, reject.
  if p_subtotal is not null and abs(p_subtotal - v_subtotal) > 0.01 then
    raise exception 'client_subtotal_mismatch';
  end if;
  if p_total is not null and abs(p_total - v_total) > 0.01 then
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
    v_total,
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
  );

  -- Second pass: insert items with server-computed pricing.
  for i in 0 .. v_len - 1 loop
    el := p_items -> i;
    v_qty := coalesce(nullif(el ->> 'quantity', '')::integer, 1);

    -- Same guardrail (defense-in-depth; keeps behavior consistent if first pass changes).
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
    v_line := v_unit * v_qty;

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
      v_unit,
      v_qty,
      v_line,
      coalesce(el -> 'configuration', '{}'::jsonb),
      nullif(trim(coalesce(el ->> 'thumbnail_url', '')), '')
    )
    returning id into v_id;

    v_item_ids := array_append(v_item_ids, v_id);
  end loop;

  return jsonb_build_object(
    'order_id', p_order_id,
    'item_ids', to_jsonb(v_item_ids),
    'subtotal', v_subtotal,
    'total', v_total
  );
end;
$$;

revoke all on function public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) from public;
grant execute on function public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) to authenticated;

-- Lock down direct UPDATEs on orders (status and everything else) from client roles.
-- Updates must go through explicit RPCs (security definer) instead.
revoke update on table public.orders from anon, authenticated;

-- Remove/disable the legacy update policy if it exists (avoid confusion when privileges change later).
drop policy if exists orders_update_own on public.orders;

-- RPC: confirm_order_payment (controlled status transition)
create or replace function public.confirm_order_payment(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_number bigint;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_order_id is null then
    raise exception 'invalid_order_id';
  end if;

  update public.orders o
  set status = 'paid'
  where o.id = p_order_id
    and o.user_id = auth.uid()
    and o.status = 'pending'
  returning o.order_number into v_order_number;

  if not found then
    raise exception 'not_found_or_forbidden';
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'order_number', v_order_number,
    'status', 'paid'
  );
end;
$$;

revoke all on function public.confirm_order_payment(uuid) from public;
grant execute on function public.confirm_order_payment(uuid) to authenticated;

