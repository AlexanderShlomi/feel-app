-- Thumbnail URL per line item + Storage bucket for order preview images

alter table public.order_items
  add column if not exists thumbnail_url text;

-- Public bucket: URLs work in <img> without signed fetch; paths are scoped by user id prefix + RLS on upload
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-thumbnails',
  'order-thumbnails',
  true,
  524288,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "order_thumbnails_insert_own" on storage.objects;
create policy "order_thumbnails_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'order-thumbnails'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "order_thumbnails_select_public" on storage.objects;
create policy "order_thumbnails_select_public"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'order-thumbnails');

drop policy if exists "order_thumbnails_update_own" on storage.objects;
create policy "order_thumbnails_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'order-thumbnails'
  and split_part(name, '/', 1) = auth.uid()::text
)
with check (
  bucket_id = 'order-thumbnails'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "order_thumbnails_delete_own" on storage.objects;
create policy "order_thumbnails_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'order-thumbnails'
  and split_part(name, '/', 1) = auth.uid()::text
);

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
    configuration,
    thumbnail_url
  )
  select
    p_order_id,
    i.type,
    i.title,
    i.subtitle,
    i.price,
    coalesce(i.quantity, 1),
    i.price * coalesce(i.quantity, 1),
    i.configuration,
    nullif(trim(i.thumbnail_url), '')
  from jsonb_to_recordset(p_items) as i(
    type text,
    title text,
    subtitle text,
    price numeric,
    quantity integer,
    configuration jsonb,
    thumbnail_url text
  );

  return p_order_id;
end;
$$;

revoke all on function public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) from public;
grant execute on function public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) to authenticated;
