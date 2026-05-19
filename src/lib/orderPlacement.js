// Order placement helpers — keep checkout/+page.svelte focused on UI.
//
// What lives here:
// - withTimeout: races a promise against a configurable timeout.
// - createCompleteOrderResilient: single resilient entry point for placing an order.
//   * Wraps the RPC with a 30s timeout per attempt.
//   * Uses the generic withRetry helper (src/lib/utils/api.js) for exponential
//     backoff (1s, 2s, 4s) and 401/403 short-circuit.
//   * The RPC itself is idempotent on p_order_id (v3 migration) — repeated
//     calls with the same id by the same user return the existing order's
//     shape instead of failing.
// - backfillOrderThumbnails: uploads thumbnails in parallel and patches all
//   order_items in a single batched RPC call.
// - sessionStorage helpers for resuming the payment screen after a refresh.

import { uploadOrderItemThumbnails } from '$lib/orderThumbnails.js';
import { uploadOrderOriginalsInBackground } from '$lib/orderOriginals.js';
import { withRetry, isAuthError, isRetriableError } from '$lib/utils/api.js';

export { uploadOrderOriginalsInBackground };

const PAYMENT_SESSION_KEY = 'feel_checkout_payment_v1';
const ORDER_RPC_TIMEOUT_MS = 30_000;
const ORDER_RPC_SLOW_WARNING_MS = 8_000;
/**
 * Backoff schedule between attempts. With 3 attempts (default) this means
 * attempt#1 → 1s → attempt#2 → 2s → attempt#3, capped at 3 attempts total.
 * We deliberately keep the schedule short on the order RPC — beyond a few
 * seconds users perceive the page as broken.
 */
const ORDER_RPC_BACKOFF_MS = [1000, 2000];
const ORDER_RPC_MAX_ATTEMPTS = 3;

/**
 * Payment confirmation is shorter than order creation: the RPC just flips a
 * status and returns. 20s is generous for mobile networks but bounded so the
 * UI doesn't appear stuck.
 */
const PAYMENT_RPC_TIMEOUT_MS = 20_000;
const PAYMENT_RPC_BACKOFF_MS = [800, 1600];
const PAYMENT_RPC_MAX_ATTEMPTS = 3;

/**
 * PostgreSQL rejects U+0000 in text and jsonb payloads (SQLSTATE 54000).
 * Prefer JSON round-trip so every string leaf seen by Postgres is sanitized;
 * fallback to recursive walk when the payload contains non-serializable values.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function stripNullBytesDeep(value) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;

    /**
     * Postgres rejects real NUL bytes (U+0000) in text. It also rejects JSON input
     * containing the unicode escape \u0000. We defensively strip both:
     *   - actual \u0000 chars
     *   - the *literal* six-char sequence "\\u0000"
     * @param {string} s
     */
    const strip = (s) => s.replace(/\u0000/g, '').replace(/\\u0000/g, '');
    try {
        return JSON.parse(
            JSON.stringify(value, (_, v) =>
                typeof v === 'string' ? strip(v) : v
            )
        );
    } catch {
        if (typeof value === 'string') return strip(value);
        if (Array.isArray(value)) return value.map(stripNullBytesDeep);
        if (typeof value === 'object') {
            /** @type {Record<string, unknown>} */
            const out = {};
            for (const k of Object.keys(/** @type {Record<string, unknown>} */ (value))) {
                const key = k.includes('\0') || k.includes('\\u0000') ? strip(k) : k;
                out[key] = stripNullBytesDeep(/** @type {Record<string, unknown>} */ (value)[k]);
            }
            return out;
        }
        return value;
    }
}

/**
 * Race a promise against a timeout. Rejects with `new Error(label)` on timeout.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, label) {
    let timer = null;
    return new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            const err = new Error(label);
            // @ts-ignore — flag for the retry layer
            err.isTimeout = true;
            reject(err);
        }, ms);
        Promise.resolve(promise).then(
            (value) => {
                if (timer) clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                if (timer) clearTimeout(timer);
                reject(err);
            }
        );
    });
}

/**
 * Detects PostgreSQL unique_violation that means the original attempt
 * actually committed and we are racing a duplicate retry.
 *
 * Note: the v3 migration makes create_complete_order idempotent on its own
 * (returning the existing order instead of raising). This detector is kept
 * as a safety net for environments still running the v2 RPC.
 *
 * @param {unknown} e
 */
function isUniqueViolation(e) {
    if (!e) return false;
    /** @type {{ code?: string; message?: string; details?: string }} */
    const err = /** @type {any} */ (e);
    if (err.code === '23505') return true;
    const text = `${err.message || ''} ${err.details || ''}`.toLowerCase();
    return text.includes('duplicate key') || text.includes('orders_pkey');
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} orderId
 * @returns {Promise<{ order_id: string; order_number: number | null; item_ids: string[]; subtotal: number; total: number }>}
 */
async function fetchExistingOrderShape(supabase, orderId) {
    const { data: ord, error: oErr } = await supabase
        .from('orders')
        .select('id, order_number, subtotal_amount, total_amount')
        .eq('id', orderId)
        .single();
    if (oErr) throw oErr;

    const { data: items, error: iErr } = await supabase
        .from('order_items')
        .select('id')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });
    if (iErr) throw iErr;

    return {
        order_id: String(ord.id),
        order_number:
            ord && typeof ord.order_number === 'number' ? ord.order_number : null,
        item_ids: (items || []).map((row) => String(row.id)),
        subtotal: Number(ord?.subtotal_amount ?? 0),
        total: Number(ord?.total_amount ?? 0)
    };
}

/**
 * Resilient wrapper around the create_complete_order RPC.
 *
 * Behavior:
 *   * Each attempt: 30s timeout.
 *   * Up to 3 attempts total with exponential backoff (1s, 2s) between them.
 *   * Auth errors (401/403/`not_authenticated`) and validation errors fail
 *     fast — no retry, no delay.
 *   * If a retry hits unique_violation (legacy v2 RPC, no longer raised by
 *     v3): the original POST committed; we fetch the existing order and
 *     return its shape (idempotent recovery).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   p_order_id: string;
 *   p_shipping_data: Record<string, unknown>;
 *   p_gift_data: Record<string, unknown>;
 *   p_items: unknown[];
 *   p_subtotal: number;
 *   p_total: number;
 * }} payload
 * @param {{ onSlow?: () => void } | undefined} [opts]
 * @returns {Promise<{ order_id: string; order_number: number | null; item_ids: string[]; subtotal: number; total: number }>}
 */
export async function createCompleteOrderResilient(supabase, payload, opts) {
    const safePayload = {
        p_order_id: payload.p_order_id,
        p_shipping_data: /** @type {Record<string, unknown>} */ (
            stripNullBytesDeep(payload.p_shipping_data)
        ),
        p_gift_data: /** @type {Record<string, unknown>} */ (stripNullBytesDeep(payload.p_gift_data)),
        p_items: /** @type {unknown[]} */ (stripNullBytesDeep(payload.p_items)),
        p_subtotal: payload.p_subtotal,
        p_total: payload.p_total
    };

    /**
     * @param {unknown} rpcResponse
     */
    const normalize = (rpcResponse) => {
        const wrapped = /** @type {{ data: unknown; error: unknown } | null} */ (
            rpcResponse
        );
        if (wrapped && wrapped.error) throw wrapped.error;
        const data = wrapped ? wrapped.data : null;
        return shapeFromRpc(payload.p_order_id, data);
    };

    const callRpc = async () => {
        const r = await withTimeout(
            supabase.rpc('create_complete_order', safePayload),
            ORDER_RPC_TIMEOUT_MS,
            'order_creation_timeout'
        );
        return normalize(r);
    };

    let slowTimer = null;
    if (opts?.onSlow) {
        slowTimer = setTimeout(() => {
            try {
                opts.onSlow && opts.onSlow();
            } catch {
                /* noop */
            }
        }, ORDER_RPC_SLOW_WARNING_MS);
    }

    try {
        return await withRetry(callRpc, {
            attempts: ORDER_RPC_MAX_ATTEMPTS,
            backoffMs: ORDER_RPC_BACKOFF_MS,
            shouldRetry: (err) => {
                // Hard stop on auth: a 401/403 won't fix itself by retrying.
                if (isAuthError(err)) return false;
                // Network/timeout/5xx — safe to retry.
                return isRetriableError(err);
            }
        });
    } catch (err) {
        // Legacy v2 RPC could surface unique_violation when a retry races a
        // succeeded original POST. v3 makes this impossible (the RPC itself
        // recovers), but we keep the safety net so a downgrade doesn't break.
        if (isUniqueViolation(err)) {
            return await fetchExistingOrderShape(supabase, payload.p_order_id);
        }
        throw err;
    } finally {
        if (slowTimer) clearTimeout(slowTimer);
    }
}

/**
 * Coerces the RPC response (jsonb) into the shape the UI expects.
 * @param {string} fallbackOrderId
 * @param {unknown} data
 */
function shapeFromRpc(fallbackOrderId, data) {
    let orderId = fallbackOrderId;
    let orderNumber = /** @type {number | null} */ (null);
    let itemIds = /** @type {string[]} */ ([]);
    let subtotal = 0;
    let total = 0;

    if (data && typeof data === 'object' && !Array.isArray(data)) {
        const o = /** @type {Record<string, unknown>} */ (data);
        if (typeof o.order_id === 'string' && o.order_id) orderId = o.order_id;
        if (typeof o.order_number === 'number') orderNumber = o.order_number;
        else if (typeof o.order_number === 'string' && o.order_number) {
            const n = Number(o.order_number);
            orderNumber = Number.isFinite(n) ? n : null;
        }
        if (Array.isArray(o.item_ids)) {
            itemIds = o.item_ids.map((id) => String(id));
        }
        if (typeof o.subtotal === 'number') subtotal = o.subtotal;
        if (typeof o.total === 'number') total = o.total;
    } else if (typeof data === 'string' && data) {
        orderId = data;
    }

    return {
        order_id: orderId,
        order_number: orderNumber,
        item_ids: itemIds,
        subtotal,
        total
    };
}

/**
 * Uploads thumbnails to Storage in parallel, then patches all rows in a single
 * RPC call (batched).
 *
 * Guarantees:
 *   - Never throws. Errors are logged via console.warn and swallowed; the
 *     returned Promise always resolves.
 *   - Returns a Promise so the checkout flow can await (with a bounded
 *     timeout) before clearing the cart and navigating to the success page.
 *     Awaiting closes the race where the user closes the tab on /checkout/
 *     success before the upload completes — thumbnails are progressive UX
 *     for /orders but still want best-effort guaranteed delivery.
 *   - Originals are intentionally NOT triggered here anymore (they used to
 *     be). The checkout flow now starts originals AFTER
 *     `confirm_order_payment` succeeds, so the originals upload does not
 *     compete with the payment RPC for the user's uplink bandwidth on
 *     mobile networks (avoids spurious payment_confirmation_timeout).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string} orderId
 * @param {Array<{ previewImage?: string | null }>} cartSnapshot
 * @param {string[]} itemRowIds
 * @returns {Promise<{ uploaded: number; total: number }>}
 */
export function backfillOrderThumbnailsInBackground(
    supabase,
    userId,
    orderId,
    cartSnapshot,
    itemRowIds
) {
    if (!userId || !orderId) return Promise.resolve({ uploaded: 0, total: 0 });
    if (!Array.isArray(itemRowIds) || itemRowIds.length === 0) {
        return Promise.resolve({ uploaded: 0, total: 0 });
    }
    if (!Array.isArray(cartSnapshot) || cartSnapshot.length === 0) {
        return Promise.resolve({ uploaded: 0, total: 0 });
    }

    return (async () => {
        try {
            const thumbnailUrls = await uploadOrderItemThumbnails(
                supabase,
                userId,
                orderId,
                cartSnapshot
            );

            const ids = [];
            const urls = [];
            const len = Math.min(itemRowIds.length, thumbnailUrls.length);
            for (let i = 0; i < len; i++) {
                const url = thumbnailUrls[i];
                if (!url) continue;
                ids.push(itemRowIds[i]);
                urls.push(url);
            }
            if (ids.length === 0) return { uploaded: 0, total: len };

            const { error } = await supabase.rpc('patch_order_item_thumbnails', {
                p_item_ids: ids,
                p_thumbnail_urls: urls
            });
            if (error) console.warn('patch_order_item_thumbnails (batch):', error);
            return { uploaded: ids.length, total: len };
        } catch (e) {
            console.warn('Order thumbnails backfill:', e);
            return { uploaded: 0, total: itemRowIds.length };
        }
    })();
}

/**
 * Persists just enough state in sessionStorage to resume the payment screen
 * after an accidental refresh. We only store the order id + amount + number;
 * the actual order belongs to the server. The session is cleared when the
 * user successfully pays or if the order is no longer 'pending'.
 *
 * @param {{ orderId: string; orderNumber: number | null; amount: number }} info
 */
export function savePaymentSession(info) {
    if (typeof sessionStorage === 'undefined') return;
    if (!info?.orderId) return;
    try {
        sessionStorage.setItem(
            PAYMENT_SESSION_KEY,
            JSON.stringify({
                orderId: info.orderId,
                orderNumber: info.orderNumber ?? null,
                amount: Number(info.amount || 0)
            })
        );
    } catch {
        /* private mode / quota — ok to ignore */
    }
}

/** @returns {{ orderId: string; orderNumber: number | null; amount: number } | null} */
export function loadPaymentSession() {
    if (typeof sessionStorage === 'undefined') return null;
    try {
        const raw = sessionStorage.getItem(PAYMENT_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.orderId !== 'string' || !parsed.orderId) return null;
        return {
            orderId: parsed.orderId,
            orderNumber:
                typeof parsed.orderNumber === 'number' ? parsed.orderNumber : null,
            amount: Number(parsed.amount || 0)
        };
    } catch {
        return null;
    }
}

export function clearPaymentSession() {
    if (typeof sessionStorage === 'undefined') return;
    try {
        sessionStorage.removeItem(PAYMENT_SESSION_KEY);
    } catch {
        /* noop */
    }
}

/**
 * Resilient wrapper around `confirm_order_payment`.
 *
 * Behavior mirrors `createCompleteOrderResilient`:
 *   * Each attempt: 20s timeout.
 *   * Up to 3 attempts total with backoff (0.8s, 1.6s).
 *   * Auth errors (401/403/not_authenticated) fail fast — no retry.
 *   * Idempotent recovery: the RPC raises `not_found_or_forbidden` if the row
 *     is no longer `pending`. On a retry that races a succeeded original we
 *     re-check the order status; if it is already `paid` and belongs to the
 *     caller, the original POST committed and we treat it as success.
 *
 * NOTE: this is intentionally provider-agnostic. When a real PSP replaces the
 * current PaymentMock, the call site will move (after PSP authorization →
 * call this helper to flip the DB status). The helper itself stays the same.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} orderId
 * @param {{ userId?: string | null; onSlow?: () => void } | undefined} [opts]
 * @returns {Promise<{ order_id: string; order_number: number | null; status: string }>}
 */
export async function confirmOrderPaymentResilient(supabase, orderId, opts) {
    if (!orderId) throw new Error('invalid_order_id');

    const userId = opts?.userId ?? null;

    /** @returns {Promise<{ order_id: string; order_number: number | null; status: string }>} */
    const callRpc = async () => {
        const r = await withTimeout(
            supabase.rpc('confirm_order_payment', { p_order_id: orderId }),
            PAYMENT_RPC_TIMEOUT_MS,
            'payment_confirmation_timeout'
        );
        const wrapped = /** @type {{ data: unknown; error: unknown } | null} */ (r);
        if (wrapped && wrapped.error) throw wrapped.error;
        const data = /** @type {Record<string, unknown> | null} */ (
            wrapped ? wrapped.data : null
        );
        const orderNumber =
            data && typeof data.order_number === 'number' ? data.order_number : null;
        const status =
            data && typeof data.status === 'string' ? data.status : 'paid';
        return { order_id: orderId, order_number: orderNumber, status };
    };

    /**
     * If the RPC raises `not_found_or_forbidden` after we already succeeded
     * once (retry race), the row is no longer `pending` because *we* moved it
     * to `paid`. Verify and recover. Returns null if recovery fails — caller
     * should rethrow the original error.
     * @returns {Promise<{ order_id: string; order_number: number | null; status: string } | null>}
     */
    const recoverAlreadyPaid = async () => {
        if (!userId) return null;
        try {
            const { data, error } = await supabase
                .from('orders')
                .select('id, status, order_number, user_id')
                .eq('id', orderId)
                .maybeSingle();
            if (error || !data) return null;
            if (data.user_id !== userId) return null;
            if (data.status !== 'paid') return null;
            const orderNumber =
                typeof data.order_number === 'number' ? data.order_number : null;
            return { order_id: orderId, order_number: orderNumber, status: 'paid' };
        } catch {
            return null;
        }
    };

    let slowTimer = null;
    if (opts?.onSlow) {
        slowTimer = setTimeout(() => {
            try {
                opts.onSlow && opts.onSlow();
            } catch {
                /* noop */
            }
        }, ORDER_RPC_SLOW_WARNING_MS);
    }

    try {
        return await withRetry(callRpc, {
            attempts: PAYMENT_RPC_MAX_ATTEMPTS,
            backoffMs: PAYMENT_RPC_BACKOFF_MS,
            shouldRetry: (err) => {
                if (isAuthError(err)) return false;
                return isRetriableError(err);
            }
        });
    } catch (err) {
        // Idempotent recovery: retry-race vs already-paid.
        const msg = String(/** @type {any} */ (err)?.message || '').toLowerCase();
        if (msg.includes('not_found_or_forbidden')) {
            const recovered = await recoverAlreadyPaid();
            if (recovered) return recovered;
        }
        throw err;
    } finally {
        if (slowTimer) clearTimeout(slowTimer);
    }
}

/**
 * Generic Hebrew message for payment-confirmation failures. Never exposes
 * raw Postgres/RPC error shape (Law 7.4). Full details still go to
 * `console.error` for devs.
 * @param {unknown} e
 * @returns {string}
 */
export function paymentConfirmErrorMessage(e) {
    /** @type {{ message?: string; isTimeout?: boolean; status?: number }} */
    const err = /** @type {any} */ (e);
    const msg = String(err?.message || '').toLowerCase();

    if (err?.isTimeout || msg.includes('payment_confirmation_timeout')) {
        return 'החיבור לשרת איטי כעת. ההזמנה לא חויבה — נסו שוב.';
    }
    if (msg.includes('failed to fetch') || msg.includes('network')) {
        return 'תקלת רשת זמנית. בדקו את החיבור לאינטרנט ונסו שוב.';
    }
    if (msg.includes('not_authenticated') || err?.status === 401) {
        return 'יש להתחבר כדי להשלים את התשלום.';
    }
    if (err?.status === 403 || msg.includes('not_found_or_forbidden')) {
        return 'לא הצלחנו לאמת את ההזמנה. רעננו את הדף — אם החיוב עבר, ההזמנה תופיע ב"ההזמנות שלי".';
    }
    return 'אופס, משהו השתבש באישור התשלום. אנחנו שומרים את העבודה שלך — נסו שוב בעוד רגע.';
}
