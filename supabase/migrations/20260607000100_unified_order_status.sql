-- =============================================================================
-- Unified Order Status Flow
-- =============================================================================
-- Merges orders.status + order_production_jobs.production_status into a single
-- linear flow on orders.status. Adds sub-task booleans to production_jobs for
-- gift pre-processing tracking.
--
-- New flow:
--   pending → paid (transient, auto-routes) → processing (gift) / ready_for_print
--           → printed → shipped → delivered
--   any (except delivered/cancelled) → cancelled
-- =============================================================================

-- ── 1. Extend orders.status constraint ───────────────────────────────────────

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'pending','paid','processing','ready_for_print',
    'printed','shipped','delivered','cancelled'
  ));

-- ── 2. Add sub-task booleans to production_jobs ───────────────────────────────

ALTER TABLE public.order_production_jobs
  ADD COLUMN IF NOT EXISTS gift_message_done boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gift_image_done   boolean NOT NULL DEFAULT false;

-- ── 3. Migrate existing data ──────────────────────────────────────────────────

-- Orders already past processing: backfill sub-tasks as done
UPDATE public.order_production_jobs pj
SET gift_message_done = true,
    gift_image_done   = true
FROM public.orders o
WHERE pj.order_id = o.id
  AND (pj.production_status IN ('ready_for_print','printed')
       OR o.status IN ('shipped','delivered','cancelled'));

-- Map production_status → orders.status
-- printed production job → order is 'printed'
UPDATE public.orders o
SET status = 'printed'
FROM public.order_production_jobs pj
WHERE pj.order_id = o.id
  AND pj.production_status = 'printed'
  AND o.status NOT IN ('shipped','delivered','cancelled');

-- ready_for_print production job + order is paid → order is 'ready_for_print'
UPDATE public.orders o
SET status = 'ready_for_print'
FROM public.order_production_jobs pj
WHERE pj.order_id = o.id
  AND pj.production_status = 'ready_for_print'
  AND o.status = 'paid';

-- needs_review + order is paid → order is 'processing'
UPDATE public.orders o
SET status = 'processing'
FROM public.order_production_jobs pj
WHERE pj.order_id = o.id
  AND pj.production_status = 'needs_review'
  AND o.status = 'paid';

-- ── 4. Drop production_status column ─────────────────────────────────────────

ALTER TABLE public.order_production_jobs
  DROP COLUMN IF EXISTS production_status;

-- ── 5. Update confirm_order_payment — auto-route past 'paid' ─────────────────

CREATE OR REPLACE FUNCTION public.confirm_order_payment(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_number bigint;
  v_gift_enabled boolean;
  v_final_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'invalid_order_id';
  END IF;

  SELECT o.order_number, o.gift_enabled
  INTO v_order_number, v_gift_enabled
  FROM public.orders o
  WHERE o.id = p_order_id
    AND o.user_id = auth.uid()
    AND o.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found_or_forbidden';
  END IF;

  v_final_status := CASE WHEN v_gift_enabled THEN 'processing' ELSE 'ready_for_print' END;

  UPDATE public.orders
  SET status = v_final_status
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'order_id',     p_order_id,
    'order_number', v_order_number,
    'status',       v_final_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_order_payment(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.confirm_order_payment(uuid) TO authenticated;

-- ── 6. Update admin_update_order_status — new transitions ────────────────────

CREATE OR REPLACE FUNCTION public.admin_update_order_status(
  p_order_id   uuid,
  p_new_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status text;
  v_order_number   bigint;
  v_gift_enabled   boolean;
  v_final_status   text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'invalid_order_id';
  END IF;

  IF p_new_status NOT IN ('paid','processing','ready_for_print','printed','shipped','delivered','cancelled') THEN
    RAISE EXCEPTION 'invalid_status_value';
  END IF;

  SELECT o.status, o.order_number, o.gift_enabled
  INTO v_current_status, v_order_number, v_gift_enabled
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  -- 'paid' is only for Bit manual payment: pending → paid → auto-route
  IF p_new_status = 'paid' THEN
    IF v_current_status <> 'pending' THEN
      RAISE EXCEPTION 'invalid_transition';
    END IF;
    v_final_status := CASE WHEN v_gift_enabled THEN 'processing' ELSE 'ready_for_print' END;
  ELSE
    v_final_status := p_new_status;
  END IF;

  -- Validate remaining transitions
  IF v_final_status = 'processing' AND v_current_status NOT IN ('pending','paid') THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;
  IF v_final_status = 'ready_for_print' AND v_current_status NOT IN ('paid','pending','processing') THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;
  IF v_final_status = 'printed' AND v_current_status <> 'ready_for_print' THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;
  IF v_final_status = 'shipped' AND v_current_status <> 'printed' THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;
  IF v_final_status = 'delivered' AND v_current_status <> 'shipped' THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;
  IF v_final_status = 'cancelled' AND v_current_status IN ('delivered','cancelled') THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;

  UPDATE public.orders
  SET status     = v_final_status,
      updated_at = now()
  WHERE id = p_order_id;

  RAISE LOG 'admin_update_order_status: order_id=% new_status=% admin_uid=%',
    p_order_id, v_final_status, auth.uid();

  RETURN jsonb_build_object(
    'order_id',     p_order_id,
    'order_number', v_order_number,
    'status',       v_final_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_order_status(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_update_order_status(uuid, text) TO authenticated;

-- ── 7. Update admin_mark_orders_printed ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_mark_orders_printed(
  p_order_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('updated', 0);
  END IF;

  UPDATE public.orders
  SET status     = 'printed',
      printed_at = COALESCE(printed_at, now()),
      updated_at = now()
  WHERE id = ANY(p_order_ids)
    AND status = 'ready_for_print';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Also stamp processed_by on production job
  UPDATE public.order_production_jobs
  SET processed_by = auth.uid()
  WHERE order_id = ANY(p_order_ids);

  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mark_orders_printed(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_mark_orders_printed(uuid[]) TO authenticated;

-- ── 8. Update admin_get_print_queue — filter by orders.status ────────────────

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
                POWER(COALESCE((oi.configuration->'settingsMeta'->>'gridBaseSize')::int, 3), 2)::int
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
            AND oi.item_type IS DISTINCT FROM 'gift'
        ),
        'items_summary',        (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'item_id',        oi2.id,
            'item_type',      oi2.item_type,
            'visible_count',  CASE
              WHEN oi2.item_type = 'mosaic' THEN
                POWER(COALESCE((oi2.configuration->'settingsMeta'->>'gridBaseSize')::int, 3), 2)::int
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
            AND oi2.item_type IS DISTINCT FROM 'gift'
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

-- ── 9. Update admin_update_production_job — remove production_status param ───
-- Drop old signatures first

DROP FUNCTION IF EXISTS public.admin_update_production_job(uuid, text, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.admin_update_production_job(uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_update_production_job(
  p_order_id               uuid,
  p_gift_message_done      boolean  DEFAULT NULL,
  p_gift_image_done        boolean  DEFAULT NULL,
  p_overridden_gift_message    text DEFAULT NULL,
  p_overridden_gift_image_path text DEFAULT NULL,
  p_overridden_gift_crop       jsonb DEFAULT NULL,
  p_admin_notes                text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
BEGIN
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = v_admin) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.order_production_jobs WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'production_job_not_found';
  END IF;

  IF p_overridden_gift_crop IS NOT NULL AND jsonb_typeof(p_overridden_gift_crop) <> 'object' THEN
    RAISE EXCEPTION 'invalid_gift_crop';
  END IF;

  UPDATE public.order_production_jobs
  SET
    gift_message_done          = COALESCE(p_gift_message_done,          gift_message_done),
    gift_image_done            = COALESCE(p_gift_image_done,            gift_image_done),
    overridden_gift_message    = CASE WHEN p_overridden_gift_message IS NOT NULL
                                      THEN public.feel_sanitize_text(p_overridden_gift_message)
                                      ELSE overridden_gift_message END,
    overridden_gift_image_path = COALESCE(p_overridden_gift_image_path, overridden_gift_image_path),
    overridden_gift_crop       = COALESCE(p_overridden_gift_crop,       overridden_gift_crop),
    admin_notes                = CASE WHEN p_admin_notes IS NOT NULL
                                      THEN public.feel_sanitize_text(p_admin_notes)
                                      ELSE admin_notes END,
    processed_by               = v_admin
  WHERE order_id = p_order_id;

  RAISE LOG 'admin_update_production_job: order_id=% admin=%', p_order_id, v_admin;

  RETURN (
    SELECT to_jsonb(pj.*)
    FROM public.order_production_jobs pj
    WHERE pj.order_id = p_order_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_production_job(uuid, boolean, boolean, text, text, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_update_production_job(uuid, boolean, boolean, text, text, jsonb, text) TO authenticated;

-- ── 10. Update admin_get_order_detail — remove production_status ──────────────

CREATE OR REPLACE FUNCTION public.admin_get_order_detail(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order      jsonb;
  v_items      jsonb;
  v_prod_job   jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT to_jsonb(o.*) INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(oi.*) ORDER BY oi.created_at), '[]'::jsonb)
  INTO v_items
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  SELECT to_jsonb(pj.*) INTO v_prod_job
  FROM public.order_production_jobs pj
  WHERE pj.order_id = p_order_id;

  RETURN jsonb_build_object(
    'order',          v_order,
    'items',          v_items,
    'production_job', COALESCE(v_prod_job, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_order_detail(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_order_detail(uuid) TO authenticated;

-- ── 11. Update create_complete_order — production job no longer sets status ───
-- The production job row is still created for tracking gift edits/notes,
-- but initial order status now routes directly on confirm_order_payment.
-- create_complete_order inserts the production job without production_status.

CREATE OR REPLACE FUNCTION public.create_complete_order(
  p_order_id     uuid,
  p_shipping_data jsonb,
  p_gift_data     jsonb,
  p_items         jsonb,
  p_subtotal      numeric,
  p_total         numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_max_name             CONSTANT int := 80;
  c_max_city_or_street   CONSTANT int := 120;
  c_max_notes            CONSTANT int := 1000;
  c_max_gift_message     CONSTANT int := 1000;
  c_max_phone            CONSTANT int := 32;
  c_max_coupon           CONSTANT int := 64;
  c_max_item_title       CONSTANT int := 200;
  c_max_item_subtitle    CONSTANT int := 300;

  v_user uuid := auth.uid();
  v_item_ids uuid[] := array[]::uuid[];
  v_units numeric[] := array[]::numeric[];
  v_qtys integer[] := array[]::integer[];
  v_id uuid;
  i integer;
  el jsonb;
  v_len integer;
  v_qty integer;
  v_unit numeric;
  v_line numeric;
  v_subtotal numeric := 0;
  v_cfg_text text;
  v_order_number bigint;

  v_first_name text;
  v_last_name text;
  v_city text;
  v_street text;
  v_notes text;
  v_house_num int;
  v_apt_num int;
  v_coupon text;
  v_gift_enabled boolean;
  v_gift_message text;
  v_gift_sender_name text;
  v_gift_sender_phone text;

  v_existing_user uuid;
  v_existing_subtotal numeric;
  v_existing_total numeric;
  v_existing_number bigint;
BEGIN
  IF v_user IS NULL THEN
    RAISE LOG 'create_complete_order: not_authenticated (order_id=%)', p_order_id;
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Idempotent fast-path
  SELECT o.user_id, o.subtotal_amount, o.total_amount, o.order_number
  INTO v_existing_user, v_existing_subtotal, v_existing_total, v_existing_number
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF FOUND THEN
    IF v_existing_user IS DISTINCT FROM v_user THEN
      RAISE LOG 'create_complete_order: order_id_taken (order_id=%, by=%, request_user=%)',
        p_order_id, v_existing_user, v_user;
      RAISE EXCEPTION 'order_id_taken';
    END IF;

    SELECT COALESCE(array_agg(oi.id ORDER BY oi.created_at), array[]::uuid[])
    INTO v_item_ids
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id;

    RETURN jsonb_build_object(
      'order_id',     p_order_id,
      'order_number', v_existing_number,
      'item_ids',     to_jsonb(v_item_ids),
      'subtotal',     v_existing_subtotal,
      'total',        v_existing_total
    );
  END IF;

  -- Items validation + server-authoritative pricing
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;

  v_len := COALESCE(jsonb_array_length(p_items), 0);
  IF v_len < 1 THEN
    RAISE EXCEPTION 'empty_items';
  END IF;

  FOR i IN 0 .. v_len - 1 LOOP
    el := p_items -> i;

    v_qty := COALESCE(NULLIF(el ->> 'quantity', '')::integer, 1);
    IF v_qty < 1 THEN
      RAISE EXCEPTION 'invalid_quantity';
    END IF;

    v_cfg_text := (COALESCE(el -> 'configuration', '{}'::jsonb))::text;
    IF octet_length(v_cfg_text) > 51200 THEN
      RAISE EXCEPTION 'configuration_too_large';
    END IF;
    IF position('data:image' IN lower(v_cfg_text)) > 0 THEN
      RAISE EXCEPTION 'configuration_contains_data_image';
    END IF;

    IF char_length(COALESCE(el ->> 'title', '')) > c_max_item_title THEN
      RAISE EXCEPTION 'item_title_too_long';
    END IF;
    IF char_length(COALESCE(el ->> 'subtitle', '')) > c_max_item_subtitle THEN
      RAISE EXCEPTION 'item_subtitle_too_long';
    END IF;

    v_unit := public.compute_order_item_unit_price(
      NULLIF(el ->> 'type', ''),
      COALESCE(el -> 'configuration', '{}'::jsonb)
    );
    IF v_unit < 0 THEN
      RAISE EXCEPTION 'invalid_price';
    END IF;

    v_line     := v_unit * v_qty;
    v_subtotal := v_subtotal + v_line;

    v_units := array_append(v_units, v_unit);
    v_qtys  := array_append(v_qtys,  v_qty);
  END LOOP;

  IF p_subtotal IS NOT NULL AND abs(p_subtotal - v_subtotal) > 0.01 THEN
    RAISE EXCEPTION 'client_subtotal_mismatch';
  END IF;
  IF p_total IS NOT NULL AND abs(p_total - v_subtotal) > 0.01 THEN
    RAISE EXCEPTION 'client_total_mismatch';
  END IF;

  -- Sanitize + length-cap shipping/gift inputs
  v_first_name        := public.feel_sanitize_text(p_shipping_data->>'firstName');
  v_last_name         := public.feel_sanitize_text(p_shipping_data->>'lastName');
  v_city              := public.feel_sanitize_text(p_shipping_data->>'city');
  v_street            := public.feel_sanitize_text(p_shipping_data->>'street');
  v_notes             := public.feel_sanitize_text(p_shipping_data->>'notes');
  v_coupon            := public.feel_sanitize_text(p_shipping_data->>'couponCode');
  v_gift_enabled      := COALESCE((p_gift_data->>'enabled')::boolean, false);
  v_gift_message      := public.feel_sanitize_text(p_gift_data->>'message');
  v_gift_sender_name  := public.feel_sanitize_text(p_gift_data->>'senderName');
  v_gift_sender_phone := public.feel_sanitize_text(p_gift_data->>'senderPhone');

  IF v_first_name IS NULL THEN RAISE EXCEPTION 'shipping_first_name_required'; END IF;
  IF v_last_name  IS NULL THEN RAISE EXCEPTION 'shipping_last_name_required';  END IF;
  IF v_city       IS NULL THEN RAISE EXCEPTION 'shipping_city_required';        END IF;
  IF v_street     IS NULL THEN RAISE EXCEPTION 'shipping_street_required';      END IF;

  IF char_length(v_first_name) > c_max_name            THEN RAISE EXCEPTION 'shipping_first_name_too_long'; END IF;
  IF char_length(v_last_name)  > c_max_name            THEN RAISE EXCEPTION 'shipping_last_name_too_long';  END IF;
  IF char_length(v_city)       > c_max_city_or_street  THEN RAISE EXCEPTION 'shipping_city_too_long';       END IF;
  IF char_length(v_street)     > c_max_city_or_street  THEN RAISE EXCEPTION 'shipping_street_too_long';     END IF;
  IF v_notes   IS NOT NULL AND char_length(v_notes)   > c_max_notes        THEN RAISE EXCEPTION 'shipping_notes_too_long';       END IF;
  IF v_coupon  IS NOT NULL AND char_length(v_coupon)  > c_max_coupon       THEN RAISE EXCEPTION 'coupon_code_too_long';          END IF;
  IF v_gift_message IS NOT NULL AND char_length(v_gift_message) > c_max_gift_message THEN RAISE EXCEPTION 'gift_message_too_long'; END IF;
  IF v_gift_sender_name  IS NOT NULL AND char_length(v_gift_sender_name)  > c_max_name  THEN RAISE EXCEPTION 'gift_sender_name_too_long';  END IF;
  IF v_gift_sender_phone IS NOT NULL AND char_length(v_gift_sender_phone) > c_max_phone THEN RAISE EXCEPTION 'gift_sender_phone_too_long'; END IF;

  v_house_num := NULLIF(p_shipping_data->>'houseNum', '')::integer;
  v_apt_num   := NULLIF(p_shipping_data->>'aptNum',   '')::integer;
  IF v_house_num IS NULL THEN RAISE EXCEPTION 'shipping_house_number_required'; END IF;
  IF v_house_num < 0 OR v_house_num > 100000 THEN RAISE EXCEPTION 'shipping_house_number_invalid'; END IF;
  IF v_apt_num IS NOT NULL AND (v_apt_num < 0 OR v_apt_num > 100000) THEN RAISE EXCEPTION 'shipping_apartment_number_invalid'; END IF;

  -- Insert the order
  INSERT INTO public.orders (
    id, user_id, status, currency, coupon_code, discount_amount,
    shipping_method, shipping_amount, subtotal_amount, total_amount,
    shipping_first_name, shipping_last_name, shipping_city, shipping_street,
    shipping_house_number, shipping_apartment_number, shipping_notes,
    gift_enabled, gift_message, gift_sender_name, gift_sender_phone
  ) VALUES (
    p_order_id, v_user, 'pending', 'ILS', v_coupon, 0,
    'home_delivery_free', 0, v_subtotal, v_subtotal,
    v_first_name, v_last_name, v_city, v_street,
    v_house_num, v_apt_num, v_notes,
    v_gift_enabled, v_gift_message, v_gift_sender_name, v_gift_sender_phone
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING order_number INTO v_order_number;

  IF v_order_number IS NULL THEN
    SELECT o.user_id, o.subtotal_amount, o.total_amount, o.order_number
    INTO v_existing_user, v_existing_subtotal, v_existing_total, v_existing_number
    FROM public.orders o
    WHERE o.id = p_order_id;

    IF NOT FOUND OR v_existing_user IS DISTINCT FROM v_user THEN
      RAISE EXCEPTION 'order_id_taken';
    END IF;

    SELECT COALESCE(array_agg(oi.id ORDER BY oi.created_at), array[]::uuid[])
    INTO v_item_ids
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id;

    RETURN jsonb_build_object(
      'order_id',     p_order_id,
      'order_number', v_existing_number,
      'item_ids',     to_jsonb(v_item_ids),
      'subtotal',     v_existing_subtotal,
      'total',        v_existing_total
    );
  END IF;

  -- Insert production job shadow row (no production_status — tracking only)
  INSERT INTO public.order_production_jobs (order_id)
  VALUES (p_order_id)
  ON CONFLICT (order_id) DO NOTHING;

  -- Items insert pass
  FOR i IN 0 .. v_len - 1 LOOP
    el := p_items -> i;

    INSERT INTO public.order_items (
      order_id, item_type, title, subtitle,
      unit_price, quantity, line_total, configuration, thumbnail_url
    )
    VALUES (
      p_order_id,
      NULLIF(el ->> 'type', ''),
      COALESCE(public.feel_sanitize_text(el ->> 'title'), ''),
      public.feel_sanitize_text(el ->> 'subtitle'),
      v_units[i + 1], v_qtys[i + 1], v_units[i + 1] * v_qtys[i + 1],
      COALESCE(el -> 'configuration', '{}'::jsonb),
      NULLIF(trim(COALESCE(el ->> 'thumbnail_url', '')), '')
    )
    RETURNING id INTO v_id;

    v_item_ids := array_append(v_item_ids, v_id);
  END LOOP;

  RETURN jsonb_build_object(
    'order_id',     p_order_id,
    'order_number', v_order_number,
    'item_ids',     to_jsonb(v_item_ids),
    'subtotal',     v_subtotal,
    'total',        v_subtotal
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'create_complete_order: unhandled exception (order_id=%, user=%, sqlstate=%, msg=%)',
      p_order_id, v_user, SQLSTATE, SQLERRM;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.create_complete_order(uuid, jsonb, jsonb, jsonb, numeric, numeric) TO authenticated;
