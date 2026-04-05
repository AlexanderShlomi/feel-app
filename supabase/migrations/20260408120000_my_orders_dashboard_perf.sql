-- ביצועים לדף ההזמנות: אינדקסים + RPC ללא N+1 + תמיכה ב־offset לעימוד

-- סדר הזמנות לפי placed_at (השאילתה בפועל); האינדקס הישן היה על created_at
create index if not exists orders_user_id_placed_at_desc_idx
  on public.orders (user_id, placed_at desc nulls last);

-- אגרגציית שורות לפי הזמנה + מיון created_at בזמן סריקה אחת
create index if not exists order_items_order_id_created_at_idx
  on public.order_items (order_id, created_at asc nulls last);

drop function if exists public.my_orders_dashboard(integer);

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
          (to_jsonb(i) - 'configuration')
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
  'הזמנות של המשתמש המחובר + items (בלי configuration). אגרגציה בבת אחת, limit/offset לעימוד.';

revoke all on function public.my_orders_dashboard(integer, integer) from public;
grant execute on function public.my_orders_dashboard(integer, integer) to authenticated;

analyze public.orders;
analyze public.order_items;
