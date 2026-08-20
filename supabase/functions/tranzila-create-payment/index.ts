/**
 * tranzila-create-payment
 *
 * Mints a payment page for a pending order. Called by the browser with the
 * user's JWT; requires `verify_jwt = true` (the default).
 *
 * Security properties:
 *   * The amount is read from `orders.total_amount` in the DB — the client
 *     never supplies a price (Law D).
 *   * That amount is then locked with a Handshake token, so tampering with
 *     `sum` in the returned URL makes Tranzila reject the transaction.
 *   * The notify nonce is minted in Postgres and embedded in the callback URL
 *     only; it is never returned to the browser.
 *   * TRANZILA_APP_KEY / TRANZILA_SECRET stay in this process.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  CURRENCY_ILS,
  IFRAME_BASE,
  createHandshakeToken,
  readTranzilaConfig
} from '../_shared/tranzila.ts';

/** Trailing slashes make origin comparison fail in confusing ways. */
function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/**
 * Resolve the origin this request may be answered on.
 *
 * A single hard-coded origin means local development cannot reach this function
 * at all: the browser drops the POST after the preflight comes back with the
 * production domain. So we allow the configured site plus loopback.
 *
 * Loopback is safe to allow even in production: an attacker cannot use
 * `localhost` to reach anyone but themselves, and every call still needs a
 * valid user JWT. Anything else falls back to the configured site, so this is
 * an allowlist and never an open redirect.
 */
function resolveOrigin(req: Request): string {
  const configured = normalizeOrigin(Deno.env.get('PUBLIC_SITE_URL') ?? '');
  const origin = normalizeOrigin(req.headers.get('Origin') ?? '');
  if (!origin) return configured;
  if (configured && origin === configured) return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return configured;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // The response body varies per origin — keep caches from crossing them over.
    Vary: 'Origin'
  };
}

function json(body: unknown, status = 200, origin = ''): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
  });
}

/**
 * Client-safe error codes. Raw Postgres / Tranzila messages never cross this
 * boundary (Law D — zero schema leaking).
 */
function safeCode(err: unknown): string {
  const msg = String((err as Error)?.message ?? '');
  const known = [
    'not_found',
    'forbidden',
    'order_not_payable',
    'invalid_amount',
    'invalid_arguments',
    'handshake_rejected',
    'missing_tranzila_secrets'
  ];
  return known.find((k) => msg.includes(k)) ?? 'payment_init_failed';
}

Deno.serve(async (req) => {
  const origin = resolveOrigin(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, origin);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const siteUrl = Deno.env.get('PUBLIC_SITE_URL');

    if (!supabaseUrl || !serviceRoleKey || !anonKey || !siteUrl) {
      console.error('[create-payment] missing platform env');
      return json({ error: 'payment_init_failed' }, 500, origin);
    }

    const cfg = readTranzilaConfig();

    // ── Authenticate the caller ──────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'not_authenticated' }, 401, origin);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const userId = userData?.user?.id;
    if (userErr || !userId) {
      return json({ error: 'not_authenticated' }, 401, origin);
    }

    const payload = await req.json().catch(() => ({}));
    const orderId = String(payload?.orderId ?? '').trim();
    if (!orderId) {
      return json({ error: 'invalid_arguments' }, 400, origin);
    }

    /* Law E: consent snapshot for the server-side purchase event. Whitelisted
       field by field — the client must not be able to write arbitrary jsonb
       into the orders row. */
    const rawConsent = payload?.consent;
    const consent =
      rawConsent && typeof rawConsent === 'object'
        ? {
            analytics: rawConsent.analytics === true,
            ads: rawConsent.ads === true,
            ga_client_id:
              typeof rawConsent.ga_client_id === 'string'
                ? rawConsent.ga_client_id.slice(0, 64)
                : null
          }
        : null;

    // ── Mint the nonce + read the authoritative amount ───────────────────────
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: begun, error: beginErr } = await admin.rpc('begin_order_payment', {
      p_order_id: orderId,
      p_user_id: userId,
      p_provider: 'tranzila',
      p_consent: consent
    });

    if (beginErr) {
      console.error('[create-payment] begin_order_payment failed', {
        code: beginErr.code,
        message: beginErr.message
      });
      return json({ error: safeCode(beginErr) }, 400, origin);
    }

    const amount = Number(begun?.amount ?? 0);
    const nonce = String(begun?.nonce ?? '');
    const orderNumber = begun?.order_number ?? null;
    if (!(amount > 0) || !nonce) {
      return json({ error: 'invalid_amount' }, 400, origin);
    }

    // ── Lock the amount with Tranzila before the page is rendered ────────────
    const thtk = await createHandshakeToken(cfg, amount);

    // ── Build the payment page URL ───────────────────────────────────────────
    // `tranmode`: 'A' = standard charge, 'V' = verification only (auth hold, no
    // capture). Kept in an env var so the first production runs can be done on
    // 'V' without a code change.
    const tranmode = Deno.env.get('TRANZILA_TRANMODE') ?? 'A';

    const notifyUrl = new URL(`${supabaseUrl}/functions/v1/tranzila-notify`);
    notifyUrl.searchParams.set('order', orderId);
    notifyUrl.searchParams.set('n', nonce);

    /* The return page is an Edge Function, not a SvelteKit route: Tranzila
       sends the customer back with a cross-site POST whose Origin is `null` or
       absent, and SvelteKit's CSRF guard rejects that before any route handler
       runs. See tranzila-return for the full reasoning.

       `site` carries the origin the customer started from, so a local session
       returns to localhost instead of being bounced to production where its
       cart and sessionStorage do not exist. It is allowlist-checked on both
       ends, so it cannot become an open redirect. */
    const returnBase = new URL(`${supabaseUrl}/functions/v1/tranzila-return`);
    returnBase.searchParams.set('order', orderId);
    returnBase.searchParams.set('site', origin || siteUrl);

    const successUrl = new URL(returnBase.toString());
    successUrl.searchParams.set('result', 'success');
    const failUrl = new URL(returnBase.toString());
    failUrl.searchParams.set('result', 'fail');

    const params = new URLSearchParams({
      sum: amount.toFixed(2),
      currency: CURRENCY_ILS,
      cred_type: '1',
      tranmode,
      thtk,
      lang: 'il',
      // Duplicate-charge guard: Tranzila rejects a second transaction carrying
      // the same value, so a double-submit cannot bill the customer twice.
      DCdisable: orderId,
      notify_url_address: notifyUrl.toString(),
      success_url_address: successUrl.toString(),
      fail_url_address: failUrl.toString()
    });

    const paymentUrl = `${IFRAME_BASE}/${cfg.terminal}/iframenew.php?${params.toString()}`;

    // No card data, no PII, no secrets — only what the UI needs to render.
    return json({
      paymentUrl,
      orderId,
      orderNumber,
      amount,
      currency: 'ILS',
      tranmode
    });
  } catch (err) {
    console.error('[create-payment] failed', { message: (err as Error)?.message });
    return json({ error: safeCode(err) }, 500, origin);
  }
});
