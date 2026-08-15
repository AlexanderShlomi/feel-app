/**
 * tranzila-notify
 *
 * The ONLY thing in the system that can move an order out of `pending`.
 * Requires `verify_jwt = false` — Tranzila calls it server-to-server with no
 * Authorization header.
 *
 * Tranzila's notify carries NO signature: the same field array is posted to the
 * success, fail and notify URLs, and anyone who learns the URL can replay it.
 * So the POST body is treated as an untrusted pointer only — "look at
 * transaction N" — and every value that decides money is re-read from
 * Tranzila's reports API and then cross-checked against our own DB:
 *
 *   1. nonce in the URL must match the one minted for this order
 *   2. transaction must be approved according to the reports API (not the POST)
 *   3. amount must match orders.total_amount within 0.01
 *   4. currency must match the order
 *   5. the transaction index must not already belong to another order
 *      (enforced by orders_payment_index_key)
 *
 * PII: the payload contains `ccno` (last 4) and may contain `TranzilaTK`.
 * Neither is stored or logged (Law D).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  currencyCodeToIso,
  fetchTransaction,
  readTranzilaConfig,
  resolveCardBrand,
  resolveCardLast4
} from '../_shared/tranzila.ts';
import { readConsent, sendGa4Purchase } from '../_shared/conversions.ts';

function ok(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Tranzila posts application/x-www-form-urlencoded in the documented flow, but
 * accept JSON too so a terminal configured differently doesn't silently fail.
 */
async function readFields(req: URL, body: string, contentType: string): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};

  // Query string first (covers GET-configured terminals).
  for (const [k, v] of req.searchParams) fields[k] = v;

  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) fields[k] = String(v);
      }
    } catch {
      /* fall through — treated as missing fields below */
    }
  } else if (body) {
    for (const [k, v] of new URLSearchParams(body)) fields[k] = v;
  }

  return fields;
}

/** Fields that must never reach a log line. */
const REDACTED = new Set(['ccno', 'TranzilaTK', 'expmonth', 'expyear', 'myid', 'email', 'contact']);

function safeLogFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (REDACTED.has(k) || k === 'n') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Build and send the server-side `purchase`.
 *
 * `transaction_id` is the order UUID — the same value the success page sends —
 * so GA4 collapses the two copies instead of counting the order twice.
 *
 * @param admin service-role client
 */
// deno-lint-ignore no-explicit-any
async function sendPurchaseConversion(admin: any, orderId: string, amount: number): Promise<string> {
  const { data: order } = await admin
    .from('orders')
    .select('currency, total_amount, analytics_consent')
    .eq('id', orderId)
    .maybeSingle();

  const consent = readConsent(order?.analytics_consent);
  if (!consent?.analytics) return 'skipped_no_consent';

  const { data: items } = await admin
    .from('order_items')
    .select('item_type, title, quantity, line_total')
    .eq('order_id', orderId);

  return await sendGa4Purchase(consent, {
    transactionId: orderId,
    value: Number(order?.total_amount ?? amount) || 0,
    currency: String(order?.currency ?? 'ILS'),
    items: (items ?? []).map((it: Record<string, unknown>) => ({
      // Item TYPE, never the customer's own title text — keeps the payload PII-free.
      item_id: String(it.item_type ?? 'item'),
      item_name: String(it.item_type ?? 'item'),
      price: Number(it.line_total ?? 0) || 0,
      quantity: Number(it.quantity ?? 1) || 1
    }))
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return ok({ error: 'method_not_allowed' }, 405);
  }

  const url = new URL(req.url);
  const orderId = (url.searchParams.get('order') ?? '').trim();
  const nonce = (url.searchParams.get('n') ?? '').trim();

  // Unknown callers get a flat 204 — no hint about whether the order exists.
  if (!orderId || !nonce) {
    return new Response(null, { status: 204 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[notify] missing platform env');
    // 5xx so Tranzila retries — this is our fault, not a rejected payment.
    return ok({ error: 'unavailable' }, 503);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  let fields: Record<string, string> = {};
  try {
    const contentType = req.headers.get('content-type') ?? '';
    const rawBody = req.method === 'POST' ? await req.text() : '';
    fields = await readFields(url, rawBody, contentType);
  } catch (err) {
    console.error('[notify] unreadable body', { message: (err as Error)?.message });
    return ok({ error: 'bad_request' }, 400);
  }

  console.log('[notify] received', { order_id: orderId, fields: safeLogFields(fields) });

  /** Record a terminal failure and answer 200 so Tranzila stops retrying. */
  async function recordFailure(reason: string, status = 200) {
    const { error } = await admin.rpc('fail_order_payment', {
      p_order_id: orderId,
      p_nonce: nonce,
      p_reason: reason
    });
    if (error) {
      console.error('[notify] fail_order_payment error', { code: error.code, reason });
    }
    return ok({ ok: false, reason }, status);
  }

  try {
    const cfg = readTranzilaConfig();

    // `index` is the transaction index; it is what the reports API calls
    // `transaction_index`. `transaction_id` is a separate display reference.
    const rawIndex = fields.index ?? fields.transaction_index ?? '';
    const txnIndex = Number(rawIndex);
    if (!Number.isFinite(txnIndex) || txnIndex <= 0) {
      return await recordFailure('missing_transaction_index');
    }

    const postedResponse = String(fields.Response ?? fields.response ?? '').trim();
    if (postedResponse && postedResponse !== '000' && postedResponse !== '0') {
      // Declined. Nothing to verify — the customer can retry with another card.
      return await recordFailure(`declined_${postedResponse}`.slice(0, 64));
    }

    // ── The load-bearing step: re-read the transaction from Tranzila ─────────
    let verified;
    try {
      verified = await fetchTransaction(cfg, txnIndex);
    } catch (err) {
      console.error('[notify] reports API unreachable', { message: (err as Error)?.message });
      // Transient — ask Tranzila to retry rather than failing the order.
      return ok({ error: 'verification_unavailable' }, 503);
    }

    if (!verified) {
      return await recordFailure('transaction_not_found');
    }
    if (!verified.approved) {
      return await recordFailure(`not_approved_${verified.responseCode || 'unknown'}`.slice(0, 64));
    }
    if (!Number.isFinite(verified.amount)) {
      return await recordFailure('verified_amount_unreadable');
    }

    /* Card descriptors for support and refund matching. Prefer the values from
       the transaction we just re-verified; fall back to the notify body only if
       the reports API did not carry them. Both are display-only — last 4 digits
       and brand are not sensitive authentication data, and the RPC re-validates
       the shape so a full PAN can never land in the column. */
    const cardLast4 = verified.cardLast4 ?? resolveCardLast4(fields.ccno);
    const cardBrand = verified.cardBrand ?? resolveCardBrand(fields.cardtype);

    // ── Hand the verified values to the DB, which applies the final checks ───
    const { data, error } = await admin.rpc('confirm_order_payment_verified', {
      p_order_id: orderId,
      p_nonce: nonce,
      p_index: verified.index,
      p_reference: String(fields.transaction_id ?? '').slice(0, 64),
      p_amount: verified.amount,
      p_currency: currencyCodeToIso(verified.currency),
      p_card_last4: cardLast4,
      p_card_brand: cardBrand
    });

    if (error) {
      const msg = String(error.message ?? '');
      console.error('[notify] confirmation rejected', {
        order_id: orderId,
        txn_index: verified.index,
        code: error.code,
        message: msg
      });

      // Amount/currency/nonce mismatches are attacks or misconfiguration, not
      // transient faults: record and stop. The order stays `pending`.
      const terminal = [
        'amount_mismatch',
        'currency_mismatch',
        'invalid_nonce',
        'order_not_payable',
        'not_found'
      ].find((k) => msg.includes(k));

      if (terminal) {
        return await recordFailure(terminal);
      }
      if (msg.includes('orders_payment_index_key')) {
        return await recordFailure('transaction_already_used');
      }
      return ok({ error: 'confirm_failed' }, 503);
    }

    console.log('[notify] confirmed', {
      order_id: orderId,
      order_number: data?.order_number,
      status: data?.status,
      already_confirmed: data?.already_confirmed
    });

    /* Law E — server-side purchase, only on the FIRST confirmation. A retried
       notify must not double-count the conversion. Best-effort: a failure here
       never changes the payment outcome. */
    if (!data?.already_confirmed) {
      try {
        const conversionStatus = await sendPurchaseConversion(admin, orderId, verified.amount);
        console.log('[notify] conversion', { order_id: orderId, status: conversionStatus });
      } catch (err) {
        console.error('[notify] conversion failed', { message: (err as Error)?.message });
      }
    }

    return ok({ ok: true, status: data?.status ?? null });
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown';
    console.error('[notify] unhandled', { order_id: orderId, message });
    if (message.includes('missing_tranzila_secrets')) {
      return ok({ error: 'unavailable' }, 503);
    }
    return ok({ error: 'unavailable' }, 503);
  }
});
