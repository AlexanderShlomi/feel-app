-- Stabilization Sprint v2 (May 2026): batched thumbnail backfill
--
-- Replaces the per-item RPC pattern (1 round-trip per line) with a single
-- batched RPC. The client uploads thumbnails in parallel to Storage, then
-- calls this RPC once with the {item_id, url} pairs.
--
-- The single-item function patch_order_item_thumbnail (added in
-- 20260410120000_create_order_return_item_ids_patch_thumbnail.sql) is kept
-- for backward compatibility. New code should call patch_order_item_thumbnails.

create or replace function public.patch_order_item_thumbnails(
  p_item_ids uuid[],
  p_thumbnail_urls text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_item_ids is null or p_thumbnail_urls is null then
    raise exception 'invalid_arguments';
  end if;

  if coalesce(array_length(p_item_ids, 1), 0) <> coalesce(array_length(p_thumbnail_urls, 1), 0) then
    raise exception 'array_length_mismatch';
  end if;

  if coalesce(array_length(p_item_ids, 1), 0) = 0 then
    return 0;
  end if;

  with payload as (
    select
      unnest(p_item_ids) as item_id,
      unnest(p_thumbnail_urls) as thumb
  ),
  updated as (
    update public.order_items oi
    set thumbnail_url = nullif(trim(p.thumb), '')
    from payload p,
         public.orders o
    where oi.id = p.item_id
      and oi.order_id = o.id
      and o.user_id = auth.uid()
      and p.thumb is not null
      and length(trim(p.thumb)) > 0
    returning oi.id
  )
  select count(*)::int into v_updated from updated;

  return coalesce(v_updated, 0);
end;
$$;

revoke all on function public.patch_order_item_thumbnails(uuid[], text[]) from public;
grant execute on function public.patch_order_item_thumbnails(uuid[], text[]) to authenticated;
