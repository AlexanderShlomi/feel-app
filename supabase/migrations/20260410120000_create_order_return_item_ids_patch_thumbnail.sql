-- create_complete_order: return { order_id, item_ids } so the client can backfill thumbnails after the order exists.
-- patch_order_item_thumbnail: allow authenticated owner to set thumbnail_url on their order line (no direct UPDATE policy on order_items).

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
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items';
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
    p_subtotal,
    p_total,
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

  v_len := coalesce(jsonb_array_length(p_items), 0);
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
      coalesce(nullif(el ->> 'price', '')::numeric, 0),
      coalesce(nullif(el ->> 'quantity', '')::integer, 1),
      coalesce(nullif(el ->> 'price', '')::numeric, 0) * coalesce(nullif(el ->> 'quantity', '')::integer, 1),
      coalesce(el -> 'configuration', '{}'::jsonb),
      nullif(trim(coalesce(el ->> 'thumbnail_url', '')), '')
    )
    returning id into v_id;
    v_item_ids := array_append(v_item_ids, v_id);
  end loop;

  return jsonb_build_object(
    'order_id', p_order_id,
    'item_ids', to_jsonb(v_item_ids)
  );
end;
$$;

revoke all on function public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) from public;
grant execute on function public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) to authenticated;

create or replace function public.patch_order_item_thumbnail(
  p_item_id uuid,
  p_thumbnail_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  update public.order_items oi
  set thumbnail_url = nullif(trim(p_thumbnail_url), '')
  from public.orders o
  where oi.id = p_item_id
    and oi.order_id = o.id
    and o.user_id = auth.uid();

  if not found then
    raise exception 'not_found_or_forbidden';
  end if;
end;
$$;

revoke all on function public.patch_order_item_thumbnail(uuid, text) from public;
grant execute on function public.patch_order_item_thumbnail(uuid, text) to authenticated;
