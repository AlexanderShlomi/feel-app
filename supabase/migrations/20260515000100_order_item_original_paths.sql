-- Phase 1 (May 2026): Store original image paths in Storage
--
-- Goals:
-- 1) Add original_storage_paths jsonb column to order_items
--    Maps magnetId → storage path for magnets_pack,
--    or { "source": "<path>" } for mosaic.
-- 2) Create private Storage bucket `order-originals`
--    (service_role read only; authenticated users can insert under their own prefix)
-- 3) RPC patch_order_item_original_paths — batched update, security definer,
--    validates caller owns the order.
--
-- configuration JSONB already captures crop/effect metadata
-- (magnetsMeta[].xPct, yPct, zoom, effectId, hidden) — no schema change needed for that.

-- ── Column ────────────────────────────────────────────────────────────────────

alter table public.order_items
  add column if not exists original_storage_paths jsonb default null;

comment on column public.order_items.original_storage_paths is
  'Map of { magnetId: storageObjectPath } for magnets_pack, or { source: storageObjectPath } for mosaic. '
  'Paths are relative keys in the order-originals bucket. '
  'Null until uploadOrderOriginals() background task completes after checkout.';

-- ── Storage bucket ────────────────────────────────────────────────────────────
-- The bucket must be created via the Supabase dashboard or CLI before these
-- policies are applied. Running this migration when the bucket does not yet
-- exist will cause the INSERT to fail — create the bucket first:
--   supabase storage create order-originals --public=false
--
-- If using the dashboard: Storage → New bucket → "order-originals", Public: OFF
-- Policies below handle access control; bucket itself is private (no public URL).

-- Allow authenticated users to upload only under their own user-id prefix.
-- Path pattern: {userId}/{orderId}/{itemId}/{fileName}
-- Insert policy: users can upload files under their own user-id prefix
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'order_originals_insert_own'
  ) then
    execute $policy$
      create policy order_originals_insert_own
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'order-originals'
        and auth.uid()::text = (string_to_array(name, '/'))[1]
      )
    $policy$;
  end if;
end;
$$;

-- Update policy: users can overwrite their own files (safe retry)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'order_originals_update_own'
  ) then
    execute $policy$
      create policy order_originals_update_own
      on storage.objects for update
      to authenticated
      using (
        bucket_id = 'order-originals'
        and auth.uid()::text = (string_to_array(name, '/'))[1]
      )
    $policy$;
  end if;
end;
$$;

-- No SELECT policy for authenticated users — only service_role can read originals.

-- ── RPC: patch_order_item_original_paths ──────────────────────────────────────
-- Called after uploadOrderOriginals() completes (background, post-checkout).
-- p_item_ids  — array of order_item UUIDs
-- p_paths_arr — parallel array of jsonb objects (one per item)
--
-- Security: security definer + validates caller owns the order via orders.user_id.
-- Safe to retry: uses jsonb merge (||) so partial updates are idempotent.

create or replace function public.patch_order_item_original_paths(
  p_item_ids  uuid[],
  p_paths_arr jsonb[]
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

  if p_item_ids is null or p_paths_arr is null then
    raise exception 'invalid_arguments';
  end if;

  if coalesce(array_length(p_item_ids, 1), 0) <>
     coalesce(array_length(p_paths_arr, 1), 0) then
    raise exception 'array_length_mismatch';
  end if;

  if coalesce(array_length(p_item_ids, 1), 0) = 0 then
    return 0;
  end if;

  with payload as (
    select
      unnest(p_item_ids)  as item_id,
      unnest(p_paths_arr) as paths
  ),
  updated as (
    update public.order_items oi
    set original_storage_paths =
          coalesce(oi.original_storage_paths, '{}'::jsonb) || p.paths
    from payload p,
         public.orders o
    where oi.id    = p.item_id
      and oi.order_id = o.id
      and o.user_id   = auth.uid()
      and p.paths is not null
      and jsonb_typeof(p.paths) = 'object'
    returning oi.id
  )
  select count(*)::int into v_updated from updated;

  return coalesce(v_updated, 0);
end;
$$;

revoke all on function public.patch_order_item_original_paths(uuid[], jsonb[]) from public;
grant execute on function public.patch_order_item_original_paths(uuid[], jsonb[]) to authenticated;
