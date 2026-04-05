-- Human-facing monotonic order number (UUID remains primary key)

create sequence if not exists public.order_number_seq;

alter table public.orders
  add column if not exists order_number bigint;

with numbered as (
  select
    id,
    row_number() over (order by placed_at asc, created_at asc, id asc) as rn
  from public.orders
  where order_number is null
)
update public.orders o
set order_number = n.rn
from numbered n
where o.id = n.id;

select setval(
  'public.order_number_seq',
  coalesce((select max(order_number) from public.orders), 0)
);

alter table public.orders
  alter column order_number set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_order_number_key'
  ) then
    alter table public.orders
      add constraint orders_order_number_key unique (order_number);
  end if;
end $$;

alter table public.orders
  alter column order_number set default nextval('public.order_number_seq');

alter sequence public.order_number_seq owned by public.orders.order_number;
