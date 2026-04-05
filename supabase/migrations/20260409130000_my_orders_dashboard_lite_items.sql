-- לא לגעת בעמודת configuration בכלל: to_jsonb(i) - 'configuration' עדיין סרק ומעבד את כל ה-jsonb הכבד לכל שורה.
-- בונים JSON רק מהשדות לדף ההזמנות — חיסכון משמעותי ב-IO וזמן CPU ב-DB ובגודל תשובה.

create or replace function public.my_orders_dashboard(
  p_max_orders integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      least(greatest(coalesce(p_max_orders, 25), 1), 50)::int as lim_n,
      greatest(coalesce(p_offset, 0), 0)::int as lim_off
  ),
  recent as (
    select o.*
    from public.orders o, params p
    where o.user_id = auth.uid()
    order by o.placed_at desc nulls last
    limit (select lim_n from params)
    offset (select lim_off from params)
  ),
  items_agg as (
    select
      i.order_id,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', i.id,
            'order_id', i.order_id,
            'title', i.title,
            'subtitle', i.subtitle,
            'thumbnail_url', i.thumbnail_url,
            'quantity', i.quantity,
            'line_total', i.line_total,
            'unit_price', i.unit_price,
            'created_at', i.created_at
          )
          order by i.created_at asc nulls last
        ),
        '[]'::jsonb
      ) as items_json
    from public.order_items i
    where i.order_id in (select id from recent)
    group by i.order_id
  ),
  with_items as (
    select
      r.*,
      coalesce(a.items_json, '[]'::jsonb) as items_json
    from recent r
    left join items_agg a on a.order_id = r.id
  )
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'order', to_jsonb(wi) - 'items_json',
          'order_items', wi.items_json
        )
        order by wi.placed_at desc nulls last
      )
      from with_items wi
    ),
    '[]'::jsonb
  );
$$;

comment on function public.my_orders_dashboard(integer, integer) is
  'הזמנות + שורות — שורות מוצר ללא קריאת configuration (jsonb_build_object בלבד).';
