-- Fix visible_tile_count for the print queue. Two regressions are repaired here:
--
--   1. GIFT tiles were excluded entirely (undercount by 1 per gift order).
--      Each gift item = exactly 1 printed tile → WHEN item_type='gift' THEN 1.
--
--   2. MOSAIC tiles were counted as power(gridBaseSize, 2) — a SQUARE-grid
--      assumption. Real mosaics are rectangular (cols × rows) driven by
--      splitImageRatio, so e.g. a 3×4 mosaic (base=3, ratio=0.75) was reported
--      as 9 instead of 12. The correct logic shipped in
--      20260520000100_admin_print_queue_real_mosaic_count.sql but was lost when
--      later CREATE OR REPLACE migrations (unified status, gift count) reverted
--      to power(base,2). This restores it.
--
-- Mosaic count priority (most authoritative first), matching the editor's
-- calculateAndRenderSplitGrid / expandMosaicToTiles exactly (Law A):
--   1. configuration.count — exact visible tile count written by the editor.
--   2. Recompute from gridBaseSize + splitImageRatio:
--        landscape (ratio > 1): cols = round(base * ratio); rows = base
--        portrait/square:       cols = base; rows = round(base / ratio)
--   3. Legacy fallback: power(base, 2) for orders predating splitImageRatio.

CREATE OR REPLACE FUNCTION public.admin_get_print_queue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'placed_at')::timestamptz ASC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id',                   o.id,
        'order_number',         o.order_number,
        'status',               o.status,
        'placed_at',            o.placed_at,
        'printed_at',           o.printed_at,
        'shipping_first_name',  o.shipping_first_name,
        'shipping_last_name',   o.shipping_last_name,
        'visible_tile_count',   (
          SELECT COALESCE(SUM(
            CASE
              WHEN oi.item_type = 'mosaic' THEN
                COALESCE(
                  -- 1) Trust configuration.count when present (set by editor).
                  NULLIF((oi.configuration->>'count')::int, 0),
                  -- 2) Recompute from base + splitImageRatio.
                  (
                    CASE
                      WHEN (oi.configuration->'settingsMeta'->>'splitImageRatio') IS NOT NULL
                       AND (oi.configuration->'settingsMeta'->>'splitImageRatio')::numeric > 0
                      THEN (
                        CASE
                          WHEN (oi.configuration->'settingsMeta'->>'splitImageRatio')::numeric > 1 THEN
                            GREATEST(1, ROUND(COALESCE((oi.configuration->'settingsMeta'->>'gridBaseSize')::numeric, 3)
                              * (oi.configuration->'settingsMeta'->>'splitImageRatio')::numeric))::int
                            * COALESCE((oi.configuration->'settingsMeta'->>'gridBaseSize')::int, 3)
                          ELSE
                            COALESCE((oi.configuration->'settingsMeta'->>'gridBaseSize')::int, 3)
                            * GREATEST(1, ROUND(COALESCE((oi.configuration->'settingsMeta'->>'gridBaseSize')::numeric, 3)
                              / (oi.configuration->'settingsMeta'->>'splitImageRatio')::numeric))::int
                        END
                      )
                      ELSE NULL
                    END
                  ),
                  -- 3) Legacy fallback: square grid (base²).
                  POWER(COALESCE((oi.configuration->'settingsMeta'->>'gridBaseSize')::int, 3), 2)::int
                )
              WHEN oi.item_type = 'gift' THEN 1
              ELSE
                (
                  SELECT COUNT(*)
                  FROM jsonb_array_elements(COALESCE(oi.configuration->'magnetsMeta', '[]'::jsonb)) elem
                  WHERE (elem->>'hidden')::boolean IS DISTINCT FROM true
                )
            END
          ), 0)::int
          FROM public.order_items oi
          WHERE oi.order_id = o.id
        ),
        'items_summary',        (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'item_id',        oi2.id,
            'item_type',      oi2.item_type,
            'visible_count',  CASE
              WHEN oi2.item_type = 'mosaic' THEN
                COALESCE(
                  NULLIF((oi2.configuration->>'count')::int, 0),
                  (
                    CASE
                      WHEN (oi2.configuration->'settingsMeta'->>'splitImageRatio') IS NOT NULL
                       AND (oi2.configuration->'settingsMeta'->>'splitImageRatio')::numeric > 0
                      THEN (
                        CASE
                          WHEN (oi2.configuration->'settingsMeta'->>'splitImageRatio')::numeric > 1 THEN
                            GREATEST(1, ROUND(COALESCE((oi2.configuration->'settingsMeta'->>'gridBaseSize')::numeric, 3)
                              * (oi2.configuration->'settingsMeta'->>'splitImageRatio')::numeric))::int
                            * COALESCE((oi2.configuration->'settingsMeta'->>'gridBaseSize')::int, 3)
                          ELSE
                            COALESCE((oi2.configuration->'settingsMeta'->>'gridBaseSize')::int, 3)
                            * GREATEST(1, ROUND(COALESCE((oi2.configuration->'settingsMeta'->>'gridBaseSize')::numeric, 3)
                              / (oi2.configuration->'settingsMeta'->>'splitImageRatio')::numeric))::int
                        END
                      )
                      ELSE NULL
                    END
                  ),
                  POWER(COALESCE((oi2.configuration->'settingsMeta'->>'gridBaseSize')::int, 3), 2)::int
                )
              WHEN oi2.item_type = 'gift' THEN 1
              ELSE
                (
                  SELECT COUNT(*)::int
                  FROM jsonb_array_elements(COALESCE(oi2.configuration->'magnetsMeta', '[]'::jsonb)) elem2
                  WHERE (elem2->>'hidden')::boolean IS DISTINCT FROM true
                )
            END
          )), '[]'::jsonb)
          FROM public.order_items oi2
          WHERE oi2.order_id = o.id
        )
      ) AS row_data
      FROM public.orders o
      LEFT JOIN public.order_production_jobs pj ON pj.order_id = o.id
      WHERE o.status = 'ready_for_print'
      ORDER BY o.placed_at ASC
    ) sub
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_print_queue() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_print_queue() TO authenticated;
