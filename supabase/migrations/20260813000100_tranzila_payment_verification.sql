-- =============================================================================
-- Tranzila payment verification (Law D — server-authoritative payment)
--
-- Before this migration the CLIENT decided when an order was paid, by calling
-- `confirm_order_payment` directly. That was acceptable while PaymentMock was
-- the only "PSP", but with a real acquirer it is forgeable from DevTools by any
-- authenticated user. This migration moves the decision entirely to the server:
--
--   * `begin_order_payment`             — mints a per-order notify nonce
--   * `confirm_order_payment_verified`  — the ONLY path from pending → routed
--   * `fail_order_payment`              — records a failure, keeps the order pending
--
-- All three are service_role-only. They are called from the `tranzila-notify` /
-- `tranzila-create-payment` Edge Functions, never from the browser.
--
-- `confirm_order_payment` (client-callable) is revoked below. Checkout is
-- expected to move to TranzilaPayment.svelte in the same release.
-- =============================================================================

-- ── 1. Payment columns ───────────────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_provider     text,
  ADD COLUMN IF NOT EXISTS payment_reference    text,        -- Tranzila `transaction_id`
  ADD COLUMN IF NOT EXISTS payment_index        bigint,      -- Tranzila `index` (== transaction_index)
  ADD COLUMN IF NOT EXISTS payment_failed_reason text,
  ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS analytics_consent    jsonb;

COMMENT ON COLUMN public.orders.analytics_consent IS
  'Consent snapshot taken at checkout: {analytics, ads, ga_client_id}. Law E — the server-side purchase event is only sent when the customer opted in, and the flag must be read at send time, not guessed.';

COMMENT ON COLUMN public.orders.payment_index IS
  'Tranzila transaction index. Unique across orders: one settled transaction can never confirm two orders (replay protection).';

-- Replay protection: a given Tranzila transaction may confirm at most one order.
CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_index_key
  ON public.orders (payment_index)
  WHERE payment_index IS NOT NULL;

-- ── 1b. Notify nonce — deliberately NOT a column on `orders` ─────────────────
--
-- The customer can SELECT their own `orders` row under RLS, so a nonce stored
-- there would be readable by the very person it defends against. That matters
-- because Tranzila transaction indexes are sequential and therefore guessable:
-- a customer who knew their nonce could fire our notify URL pointing at another
-- customer's in-flight transaction of the same amount and have their own order
-- confirmed by someone else's payment, winning the race against the genuine
-- callback.
--
-- So the nonce lives in its own table with RLS enabled and NO policies. Under
-- RLS that denies every anon/authenticated read; service_role bypasses RLS, and
-- the SECURITY DEFINER functions below run as owner.

CREATE TABLE IF NOT EXISTS public.order_payment_sessions (
  order_id   uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  nonce      text NOT NULL,
  provider   text NOT NULL DEFAULT 'tranzila',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_payment_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_payment_sessions FROM anon, authenticated;

COMMENT ON TABLE public.order_payment_sessions IS
  'Per-order notify secret. No RLS policies by design — unreachable from any client session; only service_role and the payment SECURITY DEFINER functions read it.';

-- ── 2. begin_order_payment ───────────────────────────────────────────────────
-- Called by `tranzila-create-payment` after it has authenticated the caller.
-- The user id is passed explicitly (the Edge Function verifies it against the
-- caller's JWT) because this function runs under service_role, where auth.uid()
-- is null.
--
-- Idempotent: re-entering checkout for the same pending order reuses the
-- existing nonce, so an already-open Tranzila page keeps working.

CREATE OR REPLACE FUNCTION public.begin_order_payment(
  p_order_id uuid,
  p_user_id  uuid,
  p_provider text DEFAULT 'tranzila',
  p_consent  jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order   public.orders%ROWTYPE;
  v_nonce   text;
BEGIN
  IF p_order_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_order.user_id <> p_user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_order.status <> 'pending' THEN
    -- Already paid/cancelled — never mint a payment page for it.
    RAISE EXCEPTION 'order_not_payable';
  END IF;
  IF COALESCE(v_order.total_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  /* Idempotent: re-entering checkout reuses the existing nonce so a payment
     page already open in another tab keeps working.

     The nonce is built from two gen_random_uuid() values (64 hex chars, ~244
     bits of entropy) rather than pgcrypto's gen_random_bytes: pgcrypto lives in
     the `extensions` schema, and this function pins `search_path = public`, so
     gen_random_bytes is not resolvable here. gen_random_uuid is a core builtin
     backed by pg_strong_random — no extension, no search_path fragility. */
  INSERT INTO public.order_payment_sessions (order_id, nonce, provider)
  VALUES (
    p_order_id,
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    p_provider
  )
  ON CONFLICT (order_id) DO UPDATE
    SET provider = EXCLUDED.provider
  RETURNING nonce INTO v_nonce;

  UPDATE public.orders
  SET payment_provider      = p_provider,
      payment_failed_reason = NULL,
      analytics_consent     = COALESCE(p_consent, analytics_consent)
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'order_id',     p_order_id,
    'order_number', v_order.order_number,
    'amount',       v_order.total_amount,
    'currency',     COALESCE(v_order.currency, 'ILS'),
    'nonce',        v_nonce
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_order_payment(uuid, uuid, text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_order_payment(uuid, uuid, text, jsonb) TO service_role;

-- ── 3. confirm_order_payment_verified ────────────────────────────────────────
-- The only path from `pending` to a routed status. Called by `tranzila-notify`
-- ONLY after it has re-fetched the transaction from Tranzila's reports API — the
-- notify POST itself carries no signature and is never trusted on its own.
--
-- Defence in depth, in order:
--   1. nonce must match the one minted for this order
--   2. transaction index must be unused (unique index → replay across orders)
--   3. amount must match orders.total_amount within 0.01
--   4. currency must match the order
--   5. order must still be `pending`
--
-- Idempotent: a duplicate notify for the SAME transaction index returns success
-- without re-routing, so double delivery cannot double-send emails.

CREATE OR REPLACE FUNCTION public.confirm_order_payment_verified(
  p_order_id  uuid,
  p_nonce     text,
  p_index     bigint,
  p_reference text,
  p_amount    numeric,
  p_currency  text DEFAULT 'ILS'
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

  -- (5) still payable
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

  v_final_status := CASE
    WHEN public._order_needs_processing(p_order_id) THEN 'processing'
    ELSE 'ready_for_print'
  END;

  -- (2) replay across orders is blocked by orders_payment_index_key.
  UPDATE public.orders
  SET status                = v_final_status,
      payment_index         = p_index,
      payment_reference     = NULLIF(p_reference, ''),
      payment_provider      = COALESCE(NULLIF(payment_provider, ''), 'tranzila'),
      payment_confirmed_at  = now(),
      payment_failed_reason = NULL
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'order_id',          p_order_id,
    'order_number',      v_order.order_number,
    'status',            v_final_status,
    'already_confirmed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_order_payment_verified(uuid, text, bigint, text, numeric, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order_payment_verified(uuid, text, bigint, text, numeric, text) TO service_role;

-- ── 4. fail_order_payment ────────────────────────────────────────────────────
-- Records a declined/failed attempt for support and telemetry. The order stays
-- `pending` so the customer can retry with another card.
--
-- p_reason is a short machine code (e.g. 'declined_004', 'amount_mismatch') —
-- never a raw acquirer message, which can carry PII.

CREATE OR REPLACE FUNCTION public.fail_order_payment(
  p_order_id uuid,
  p_nonce    text,
  p_reason   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_nonce text;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT s.nonce INTO v_nonce
  FROM public.order_payment_sessions s
  WHERE s.order_id = p_order_id;

  IF COALESCE(v_nonce, '') = '' OR v_nonce IS DISTINCT FROM p_nonce THEN
    RAISE EXCEPTION 'invalid_nonce';
  END IF;

  -- Never overwrite a settled order with a failure record.
  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'status', v_order.status, 'recorded', false);
  END IF;

  UPDATE public.orders
  SET payment_failed_reason = left(COALESCE(p_reason, 'unknown'), 64)
  WHERE id = p_order_id;

  RETURN jsonb_build_object('order_id', p_order_id, 'status', 'pending', 'recorded', true);
END;
$$;

REVOKE ALL ON FUNCTION public.fail_order_payment(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_order_payment(uuid, text, text) TO service_role;

-- ── 5. Close the client-side confirmation path ───────────────────────────────
-- This is the actual security fix. After this, no browser session can move an
-- order out of `pending`, regardless of what it sends.

REVOKE EXECUTE ON FUNCTION public.confirm_order_payment(uuid) FROM authenticated, anon;

COMMENT ON FUNCTION public.confirm_order_payment(uuid) IS
  'DEPRECATED — client-callable payment confirmation. Execute revoked from authenticated as of the Tranzila integration; superseded by confirm_order_payment_verified (service_role only). Kept for migration history only.';
