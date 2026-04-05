-- RPC: create_complete_order (atomic order + items)
-- Rationale: avoid partial writes when client disconnects.

create or replace function public.create_complete_order(
  p_order_id uuid,
  p_shipping_data jsonb,
  p_gift_data jsonb,
  p_items jsonb,
  p_subtotal numeric,
  p_total numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
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

  insert into public.order_items (
    order_id,
    item_type,
    title,
    subtitle,
    unit_price,
    quantity,
    line_total,
    configuration
  )
  select
    p_order_id,
    i.type,
    i.title,
    i.subtitle,
    i.price,
    coalesce(i.quantity, 1),
    i.price * coalesce(i.quantity, 1),
    i.configuration
  from jsonb_to_recordset(p_items) as i(
    type text,
    title text,
    subtitle text,
    price numeric,
    quantity integer,
    configuration jsonb
  );

  return p_order_id;
end;
$$;

revoke all on function public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) from public;
grant execute on function public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) to authenticated;

