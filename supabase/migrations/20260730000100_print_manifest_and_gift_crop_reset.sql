-- =============================================================================
-- Print workflow accuracy: batch manifest data + gift-crop reset
-- =============================================================================
-- 1) admin_get_print_originals — expose admin_notes and make the row ordering
--    an explicit aggregate ORDER BY.
--
--    The batch work order ("דף עבודה", src/lib/admin/PrintManifest.svelte)
--    prints the greeting and the admin notes next to each order. The greeting
--    was already returned and unused; admin_notes was not returned at all.
--
--    The ordering change is a Law A hardening: the function relied on
--    `jsonb_agg(row_data)` picking up the ORDER BY of its sub-select. That
--    happens to hold today but Postgres does not guarantee input order to an
--    aggregate without an explicit ORDER BY inside it. The tile stream — and
--    therefore which cell of a mosaic lands where on the sheet — is built from
--    this order, so it must be stated rather than inherited.
--
-- 2) admin_update_production_job — add p_clear_gift_crop.
--
--    `overridden_gift_crop = COALESCE(p_overridden_gift_crop, ...)` means NULL
--    is "leave unchanged", so there was NO way to clear a saved crop. Uploading
--    a replacement gift image therefore kept the zoom/pan/effect that belonged
--    to the PREVIOUS image and silently applied it to the new one — a Law A
--    violation that only becomes visible on paper.
-- =============================================================================

-- ── 1. admin_get_print_originals — + admin_notes, explicit ordering ──────────

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
    select coalesce(
      jsonb_agg(row_data order by sort_placed_at asc, sort_item_created_at asc),
      '[]'::jsonb
    )
    from (
      select
        o.placed_at  as sort_placed_at,
        oi.created_at as sort_item_created_at,
        jsonb_build_object(
          'order_id',               o.id,
          'order_number',           o.order_number,
          'shipping_first_name',    o.shipping_first_name,
          'shipping_last_name',     o.shipping_last_name,
          'gift_enabled',           o.gift_enabled,
          'gift_message',           coalesce(pj.overridden_gift_message, o.gift_message),
          'gift_image_path',        pj.overridden_gift_image_path,
          'overridden_gift_crop',   pj.overridden_gift_crop,
          'admin_notes',            pj.admin_notes,
          'item_id',                oi.id,
          'item_type',              oi.item_type,
          'configuration',          oi.configuration,
          'original_storage_paths', oi.original_storage_paths
        ) as row_data
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      left join public.order_production_jobs pj on pj.order_id = o.id
      where o.id = any(p_order_ids)
    ) sub
  );
end;
$$;

revoke all on function public.admin_get_print_originals(uuid[]) from public;
grant execute on function public.admin_get_print_originals(uuid[]) to authenticated;

-- ── 2. admin_update_production_job — + p_clear_gift_crop ─────────────────────
-- Adding a parameter changes the signature, so the previous one is dropped
-- first. Every caller uses named arguments, so appending the flag is
-- backward-compatible.

drop function if exists public.admin_update_production_job(uuid, boolean, boolean, text, text, jsonb, text);

create or replace function public.admin_update_production_job(
  p_order_id                   uuid,
  p_gift_message_done          boolean DEFAULT NULL,
  p_gift_image_done            boolean DEFAULT NULL,
  p_overridden_gift_message    text    DEFAULT NULL,
  p_overridden_gift_image_path text    DEFAULT NULL,
  p_overridden_gift_crop       jsonb   DEFAULT NULL,
  p_admin_notes                text    DEFAULT NULL,
  p_clear_gift_crop            boolean DEFAULT false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
begin
  if v_admin is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.admin_users where user_id = v_admin) then
    raise exception 'not_admin';
  end if;

  if not exists (select 1 from public.order_production_jobs where order_id = p_order_id) then
    raise exception 'production_job_not_found';
  end if;

  if p_overridden_gift_crop is not null and jsonb_typeof(p_overridden_gift_crop) <> 'object' then
    raise exception 'invalid_gift_crop';
  end if;

  -- Clearing and setting a crop in the same call is contradictory; refuse
  -- rather than silently picking one.
  if coalesce(p_clear_gift_crop, false) and p_overridden_gift_crop is not null then
    raise exception 'conflicting_gift_crop_args';
  end if;

  update public.order_production_jobs
  set
    gift_message_done          = coalesce(p_gift_message_done, gift_message_done),
    gift_image_done            = coalesce(p_gift_image_done,   gift_image_done),
    overridden_gift_message    = case when p_overridden_gift_message is not null
                                      then public.feel_sanitize_text(p_overridden_gift_message)
                                      else overridden_gift_message end,
    overridden_gift_image_path = coalesce(p_overridden_gift_image_path, overridden_gift_image_path),
    -- Explicit clear wins; otherwise NULL still means "leave unchanged".
    overridden_gift_crop       = case when coalesce(p_clear_gift_crop, false) then null
                                      else coalesce(p_overridden_gift_crop, overridden_gift_crop) end,
    admin_notes                = case when p_admin_notes is not null
                                      then public.feel_sanitize_text(p_admin_notes)
                                      else admin_notes end,
    processed_by               = v_admin
  where order_id = p_order_id;

  raise log 'admin_update_production_job: order_id=% admin=% clear_crop=%',
    p_order_id, v_admin, coalesce(p_clear_gift_crop, false);

  return (
    select to_jsonb(pj.*)
    from public.order_production_jobs pj
    where pj.order_id = p_order_id
  );
end;
$$;

revoke all on function public.admin_update_production_job(uuid, boolean, boolean, text, text, jsonb, text, boolean) from public;
grant execute on function public.admin_update_production_job(uuid, boolean, boolean, text, text, jsonb, text, boolean) to authenticated;
