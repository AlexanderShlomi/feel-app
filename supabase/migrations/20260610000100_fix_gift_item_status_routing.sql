-- =============================================================================
-- Fix: orders with a gift magnet item (item_type='gift') but no gift_enabled
-- flag were incorrectly routed to 'ready_for_print' instead of 'processing'.
-- Both confirm_order_payment and admin_update_order_status must treat any order
-- that contains a gift item as needing admin review.
-- =============================================================================

-- Helper: returns true when the order needs admin prep before printing.
-- Condition: either the checkout gift-option was enabled, OR the cart contains
-- at least one gift magnet item (item_type = 'gift').
CREATE OR REPLACE FUNCTION public._order_needs_processing(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(o.gift_enabled, false)
    OR EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.order_id = p_order_id AND oi.item_type = 'gift'
    )
  FROM public.orders o
  WHERE o.id = p_order_id;
$$;

REVOKE ALL ON FUNCTION public._order_needs_processing(uuid) FROM public;

-- ── confirm_order_payment ─────────────────────────────────────────────────────

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
  v_final_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'invalid_order_id';
  END IF;

  SELECT o.order_number
  INTO v_order_number
  FROM public.orders o
  WHERE o.id = p_order_id
    AND o.user_id = auth.uid()
    AND o.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found_or_forbidden';
  END IF;

  v_final_status := CASE
    WHEN public._order_needs_processing(p_order_id) THEN 'processing'
    ELSE 'ready_for_print'
  END;

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

-- ── admin_update_order_status ─────────────────────────────────────────────────

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

  SELECT o.status, o.order_number
  INTO v_current_status, v_order_number
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
    v_final_status := CASE
      WHEN public._order_needs_processing(p_order_id) THEN 'processing'
      ELSE 'ready_for_print'
    END;
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
