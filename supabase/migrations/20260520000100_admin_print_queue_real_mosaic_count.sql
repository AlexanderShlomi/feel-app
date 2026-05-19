-- ──────────────────────────────────────────────────────────────────────────────
-- Patch: admin_get_print_queue — count mosaic tiles by their REAL grid
-- (cols × rows), not gridBaseSize².
--
-- Bug:
--   The original RPC computed visible_tile_count for mosaics as power(base,2),
--   which is only correct for a square grid. A 4×3 mosaic with base=3 and
--   splitImageRatio≈1.33 was reported as 9 tiles instead of 12. The print
--   packer (`packOrdersIntoPages`) then under-allocated paper, and the
--   admin UI showed a misleading magnet count.
--
-- Fix priority (most authoritative first):
--   1. `configuration.count` — the editor wrote the exact visible tile count
--      at order time. This is always trusted when present and positive.
--   2. Recompute from `gridBaseSize` + `splitImageRatio` using the same
--      algorithm as the editor's `calculateAndRenderSplitGrid`:
--        landscape (ratio > 1):  cols = round(base * ratio); rows = base
--        portrait/square:        cols = base; rows = round(base / ratio)
--   3. Legacy fallback: power(base, 2). Older orders predate splitImageRatio
--      and need the previous behaviour to avoid blowing up.
--
-- This patch is idempotent (CREATE OR REPLACE) and respects Law A: print
-- planning must match the editor's tile count exactly.
-- ──────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_get_print_queue()
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

  return (
    select coalesce(jsonb_agg(row_data order by (row_data->>'placed_at')::timestamptz asc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id',                   o.id,
        'order_number',         o.order_number,
        'status',               o.status,
        'placed_at',            o.placed_at,
        'printed_at',           o.printed_at,
        'shipping_first_name',  o.shipping_first_name,
        'shipping_last_name',   o.shipping_last_name,
        'visible_tile_count',   (
          select coalesce(sum(
            case
              when oi.item_type = 'mosaic' then
                coalesce(
                  -- 1) Trust configuration.count when present (set by editor).
                  nullif((oi.configuration->>'count')::int, 0),
                  -- 2) Recompute from base + splitImageRatio.
                  (
                    case
                      when (oi.configuration->'settingsMeta'->>'splitImageRatio') is not null
                       and (oi.configuration->'settingsMeta'->>'splitImageRatio')::numeric > 0
                      then (
                        case
                          when (oi.configuration->'settingsMeta'->>'splitImageRatio')::numeric > 1 then
                            greatest(1, round(coalesce((oi.configuration->'settingsMeta'->>'gridBaseSize')::numeric, 3)
                              * (oi.configuration->'settingsMeta'->>'splitImageRatio')::numeric))::int
                            * coalesce((oi.configuration->'settingsMeta'->>'gridBaseSize')::int, 3)
                          else
                            coalesce((oi.configuration->'settingsMeta'->>'gridBaseSize')::int, 3)
                            * greatest(1, round(coalesce((oi.configuration->'settingsMeta'->>'gridBaseSize')::numeric, 3)
                              / (oi.configuration->'settingsMeta'->>'splitImageRatio')::numeric))::int
                        end
                      )
                      else null
                    end
                  ),
                  -- 3) Legacy fallback: square grid (base²).
                  power(coalesce((oi.configuration->'settingsMeta'->>'gridBaseSize')::int, 3), 2)::int
                )
              else
                -- magnets_pack: count non-hidden entries in magnetsMeta
                (
                  select count(*)::int
                  from jsonb_array_elements(coalesce(oi.configuration->'magnetsMeta', '[]'::jsonb)) elem
                  where (elem->>'hidden')::boolean is distinct from true
                )
            end
          ), 0)::int
          from public.order_items oi
          where oi.order_id = o.id
        ),
        'items_summary',        (
          select coalesce(jsonb_agg(jsonb_build_object(
            'item_id',        oi2.id,
            'item_type',      oi2.item_type,
            'visible_count',  case
              when oi2.item_type = 'mosaic' then
                coalesce(
                  nullif((oi2.configuration->>'count')::int, 0),
                  (
                    case
                      when (oi2.configuration->'settingsMeta'->>'splitImageRatio') is not null
                       and (oi2.configuration->'settingsMeta'->>'splitImageRatio')::numeric > 0
                      then (
                        case
                          when (oi2.configuration->'settingsMeta'->>'splitImageRatio')::numeric > 1 then
                            greatest(1, round(coalesce((oi2.configuration->'settingsMeta'->>'gridBaseSize')::numeric, 3)
                              * (oi2.configuration->'settingsMeta'->>'splitImageRatio')::numeric))::int
                            * coalesce((oi2.configuration->'settingsMeta'->>'gridBaseSize')::int, 3)
                          else
                            coalesce((oi2.configuration->'settingsMeta'->>'gridBaseSize')::int, 3)
                            * greatest(1, round(coalesce((oi2.configuration->'settingsMeta'->>'gridBaseSize')::numeric, 3)
                              / (oi2.configuration->'settingsMeta'->>'splitImageRatio')::numeric))::int
                        end
                      )
                      else null
                    end
                  ),
                  power(coalesce((oi2.configuration->'settingsMeta'->>'gridBaseSize')::int, 3), 2)::int
                )
              else
                (
                  select count(*)::int
                  from jsonb_array_elements(coalesce(oi2.configuration->'magnetsMeta', '[]'::jsonb)) elem2
                  where (elem2->>'hidden')::boolean is distinct from true
                )
            end
          )), '[]'::jsonb)
          from public.order_items oi2
          where oi2.order_id = o.id
        )
      ) as row_data
      from public.orders o
      where o.status in ('paid', 'processing')
      order by o.placed_at asc
    ) sub
  );
end;
$$;

revoke all on function public.admin_get_print_queue() from public;
grant execute on function public.admin_get_print_queue() to authenticated;
