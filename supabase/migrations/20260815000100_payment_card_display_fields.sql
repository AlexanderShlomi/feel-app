-- =============================================================================
-- Store the non-sensitive card descriptors: last 4 digits + brand.
--
-- PCI: the last four digits and the brand are NOT sensitive authentication
-- data and may be stored in the clear. The PAN, expiry, CVV and cardholder name
-- still never reach our servers — they are entered inside Tranzila's iframe on
-- their domain, so we stay in SAQ-A.
--
-- Why store them: support ("the charge on the card ending 1234") and matching
-- refunds against the Tranzila panel. The privacy policy already discloses this.
--
-- Both values are display-only. They are written from the transaction we
-- re-verified against Tranzila's reports API, and the RPC re-validates the
-- shape so a malformed notify cannot write junk into the row.
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_card_last4 text,
  ADD COLUMN IF NOT EXISTS payment_card_brand text;

COMMENT ON COLUMN public.orders.payment_card_last4 IS
  'Last 4 digits of the card. Display only. Never the full PAN — that never reaches our servers.';
COMMENT ON COLUMN public.orders.payment_card_brand IS
  'Card brand (Visa / Mastercard / Isracard / ...), resolved from the Tranzila cardtype code.';

-- The signature changes, so drop the old one rather than leaving two overloads
-- that PostgREST could resolve ambiguously.
DROP FUNCTION IF EXISTS public.confirm_order_payment_verified(uuid, text, bigint, text, numeric, text);

CREATE OR REPLACE FUNCTION public.confirm_order_payment_verified(
  p_order_id   uuid,
  p_nonce      text,
  p_index      bigint,
  p_reference  text,
  p_amount     numeric,
  p_currency   text DEFAULT 'ILS',
  p_card_last4 text DEFAULT NULL,
  p_card_brand text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order        public.orders%ROWTYPE;
  v_nonce        text;
  v_final_status text;
  v_last4        text;
  v_brand        text;
BEGIN
  IF p_order_id IS NULL OR p_index IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- (1) nonce
  SELECT s.nonce INTO v_nonce
  FROM public.order_payment_sessions s
  WHERE s.order_id = p_order_id;

  IF COALESCE(v_nonce, '') = '' OR v_nonce IS DISTINCT FROM p_nonce THEN
    RAISE EXCEPTION 'invalid_nonce';
  END IF;

  -- Idempotency: same transaction, already applied.
  IF v_order.status <> 'pending' AND v_order.payment_index = p_index THEN
    RETURN jsonb_build_object(
      'order_id',          p_order_id,
      'order_number',      v_order.order_number,
      'status',            v_order.status,
      'already_confirmed', true
    );
  END IF;

  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'order_not_payable';
  END IF;

  -- (3) amount — server value wins, always
  IF p_amount IS NULL OR abs(COALESCE(v_order.total_amount, 0) - p_amount) > 0.01 THEN
    RAISE EXCEPTION 'amount_mismatch';
  END IF;

  -- (4) currency
  IF upper(COALESCE(p_currency, '')) IS DISTINCT FROM upper(COALESCE(v_order.currency, 'ILS')) THEN
    RAISE EXCEPTION 'currency_mismatch';
  END IF;

  /* Card descriptors are display-only, so a bad value must never fail a real
     payment — it is dropped instead. Exactly 4 digits, or nothing: this also
     guarantees a full PAN can never land in this column by accident. */
  v_last4 := CASE
    WHEN p_card_last4 ~ '^[0-9]{4}$' THEN p_card_last4
    ELSE NULL
  END;
  v_brand := left(nullif(trim(COALESCE(p_card_brand, '')), ''), 24);

  v_final_status := CASE
    WHEN public._order_needs_processing(p_order_id) THEN 'processing'
    ELSE 'ready_for_print'
  END;

  UPDATE public.orders
  SET status                = v_final_status,
      payment_index         = p_index,
      payment_reference     = NULLIF(p_reference, ''),
      payment_provider      = COALESCE(NULLIF(payment_provider, ''), 'tranzila'),
      payment_card_last4    = v_last4,
      payment_card_brand    = v_brand,
      payment_confirmed_at  = now(),
      payment_failed_reason = NULL
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'order_id',          p_order_id,
    'order_number',      v_order.order_number,
    'status',            v_final_status,
    'card_last4',        v_last4,
    'card_brand',        v_brand,
    'already_confirmed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_order_payment_verified(uuid, text, bigint, text, numeric, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order_payment_verified(uuid, text, bigint, text, numeric, text, text, text) TO service_role;
