-- הזמנות + שורות בקריאת RPC אחת (פחות סיבובי רשת מול שתי שאילתות + פחות סיכוי ל-timeout בצד לקוח)

create or replace function public.my_orders_dashboard(p_max_orders integer default 40)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with lim as (
    select least(greatest(coalesce(p_max_orders, 40), 1), 100)::int as n
  ),
  recent as (
    select o.*
    from public.orders o, lim
    where o.user_id = auth.uid()
    order by o.placed_at desc nulls last
    limit (select n from lim)
  ),
  with_items as (
    select
      r.*,
      coalesce(
        (
          select jsonb_agg(
            (to_jsonb(i) - 'configuration')
            order by i.created_at asc nulls last
          )
          from public.order_items i
          where i.order_id = r.id
        ),
        '[]'::jsonb
      ) as items_json
    from recent r
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

comment on function public.my_orders_dashboard(integer) is
  'מחזיר עד N הזמנות של המשתמש המחובר עם order_items (בלי configuration) — לדף ההזמנות.';

revoke all on function public.my_orders_dashboard(integer) from public;
grant execute on function public.my_orders_dashboard(integer) to authenticated;
