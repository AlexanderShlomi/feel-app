-- Extend admin_get_print_originals to include overridden_gift_crop.
-- The previous migration (20260605000200) added the column but its comment
-- incorrectly assumed the RPC would auto-include it via to_jsonb(pj.*).
-- The RPC uses jsonb_build_object with explicit fields, so we must add it here.

create or replace function public.admin_get_print_originals(
  p_order_ids uuid[]
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

  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(jsonb_agg(row_data), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'order_id',               o.id,
        'order_number',           o.order_number,
        'shipping_first_name',    o.shipping_first_name,
        'shipping_last_name',     o.shipping_last_name,
        'gift_enabled',           o.gift_enabled,
        'gift_message',           coalesce(pj.overridden_gift_message, o.gift_message),
        'gift_image_path',        pj.overridden_gift_image_path,
        'overridden_gift_crop',   pj.overridden_gift_crop,
        'item_id',                oi.id,
        'item_type',              oi.item_type,
        'configuration',          oi.configuration,
        'original_storage_paths', oi.original_storage_paths
      ) as row_data
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      left join public.order_production_jobs pj on pj.order_id = o.id
      where o.id = any(p_order_ids)
      order by o.placed_at asc, oi.created_at asc
    ) sub
  );
end;
$$;

revoke all on function public.admin_get_print_originals(uuid[]) from public;
grant execute on function public.admin_get_print_originals(uuid[]) to authenticated;
