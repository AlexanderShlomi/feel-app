-- Add gift_message + has_gift_item to admin_get_orders so the list view can show
-- מתנה / ברכה indicators for both checkout-gift and editor bonus-magnet orders.

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
        'gift_message',         o.gift_message,
        'has_gift_item',        exists(
          select 1 from public.order_items gi
          where gi.order_id = o.id and gi.item_type = 'gift'
        ),
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
