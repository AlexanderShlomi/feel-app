-- Add overridden_gift_crop JSONB column to order_production_jobs.
-- Stores admin-adjusted crop + effect for the replacement gift image:
--   { zoom: number, xPct: number, yPct: number, effect: string }
-- Never touches public.orders or public.order_items.

alter table public.order_production_jobs
  add column if not exists overridden_gift_crop jsonb default null;

comment on column public.order_production_jobs.overridden_gift_crop is
  'Admin-set crop/effect for the replacement gift image: {zoom, xPct, yPct, effect}';

-- Update admin_update_production_job to accept the new field.
create or replace function public.admin_update_production_job(
  p_order_id uuid,
  p_production_status text default null,
  p_overridden_gift_message text default null,
  p_overridden_gift_image_path text default null,
  p_overridden_gift_crop jsonb default null,
  p_admin_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_current_status text;
begin
  if v_admin is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.admin_users where user_id = v_admin) then
    raise exception 'not_admin';
  end if;

  select pj.production_status into v_current_status
  from public.order_production_jobs pj
  where pj.order_id = p_order_id;

  if not found then
    raise exception 'production_job_not_found';
  end if;

  if p_production_status is not null then
    if p_production_status not in ('needs_review', 'ready_for_print', 'printed') then
      raise exception 'invalid_production_status';
    end if;
    if v_current_status = 'printed' and p_production_status <> 'printed' then
      raise exception 'cannot_revert_printed';
    end if;
  end if;

  -- Validate crop shape if provided
  if p_overridden_gift_crop is not null then
    if jsonb_typeof(p_overridden_gift_crop) <> 'object' then
      raise exception 'invalid_gift_crop';
    end if;
  end if;

  update public.order_production_jobs
  set
    production_status          = coalesce(p_production_status, production_status),
    overridden_gift_message    = case when p_overridden_gift_message is not null
                                      then public.feel_sanitize_text(p_overridden_gift_message)
                                      else overridden_gift_message end,
    overridden_gift_image_path = coalesce(p_overridden_gift_image_path, overridden_gift_image_path),
    overridden_gift_crop       = coalesce(p_overridden_gift_crop, overridden_gift_crop),
    admin_notes                = case when p_admin_notes is not null
                                      then public.feel_sanitize_text(p_admin_notes)
                                      else admin_notes end,
    processed_by               = v_admin
  where order_id = p_order_id;

  raise log 'admin_update_production_job: order_id=% status=% admin=%',
    p_order_id, coalesce(p_production_status, v_current_status), v_admin;

  return (
    select to_jsonb(pj.*)
    from public.order_production_jobs pj
    where pj.order_id = p_order_id
  );
end;
$$;

revoke all on function public.admin_update_production_job(uuid, text, text, text, jsonb, text) from public;
grant execute on function public.admin_update_production_job(uuid, text, text, text, jsonb, text) to authenticated;

-- Drop the old 5-arg signature so there's no ambiguity.
drop function if exists public.admin_update_production_job(uuid, text, text, text, text);

-- admin_get_print_originals already returns to_jsonb(pj.*) via the LEFT JOIN,
-- so overridden_gift_crop is automatically included in every row.
