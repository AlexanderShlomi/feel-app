// Order placement helpers — keep checkout/+page.svelte focused on UI.
//
// What lives here:
// - withTimeout: races a promise against a configurable timeout.
// - createCompleteOrderResilient: single resilient entry point for placing an order.
//   * Wraps the RPC with a 30s timeout.
//   * Retries once on transient timeout/network errors with a short backoff.
//   * If the retry hits a unique-violation on the same order id, the original
//     attempt actually succeeded — we recover by reading the existing order.
// - backfillOrderThumbnails: uploads thumbnails in parallel and patches all
//   order_items in a single batched RPC call.
// - sessionStorage helpers for resuming the payment screen after a refresh.

import { uploadOrderItemThumbnails } from '$lib/orderThumbnails.js';

const PAYMENT_SESSION_KEY = 'feel_checkout_payment_v1';
const ORDER_RPC_TIMEOUT_MS = 30_000;
const ORDER_RPC_SLOW_WARNING_MS = 8_000;
const ORDER_RPC_RETRY_BACKOFF_MS = 700;

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
 * @param {unknown} e
 * @returns {boolean} true when the failure happened before the server responded
 *   (timeout / browser network glitch). These are safe to retry.
 */
function isRetriableNetworkError(e) {
    if (!e) return false;
    /** @type {{ message?: string; isTimeout?: boolean; name?: string }} */
    const err = /** @type {any} */ (e);
    if (err.isTimeout) return true;
    const msg = String(err.message || '').toLowerCase();
    if (!msg) return false;
    return (
        msg.includes('failed to fetch') ||
        msg.includes('network') ||
        msg.includes('networkerror') ||
        msg.includes('aborted') ||
        msg.includes('timeout') ||
        err.name === 'AbortError'
    );
}

/**
 * Detects PostgreSQL unique_violation that means the original attempt
 * actually committed and we are racing a duplicate retry.
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
 *   * Attempt 1: 30s timeout.
 *   * If timeout / browser network error: wait 700ms, retry once.
 *   * If retry fails with unique_violation: the original POST committed, we
 *     fetch the existing order and return its shape (idempotent recovery).
 *   * Other RPC errors (validation, mismatch, auth) bubble up immediately,
 *     no retry.
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
    const callRpc = () =>
        withTimeout(
            supabase.rpc('create_complete_order', payload),
            ORDER_RPC_TIMEOUT_MS,
            'order_creation_timeout'
        );

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

    try {
        try {
            const r = await callRpc();
            return normalize(r);
        } catch (firstErr) {
            if (!isRetriableNetworkError(firstErr)) throw firstErr;

            await new Promise((r) => setTimeout(r, ORDER_RPC_RETRY_BACKOFF_MS));

            try {
                const r2 = await callRpc();
                return normalize(r2);
            } catch (secondErr) {
                if (isUniqueViolation(secondErr)) {
                    return await fetchExistingOrderShape(supabase, payload.p_order_id);
                }
                throw secondErr;
            }
        }
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
 * RPC call (batched). Errors are logged but never propagated — thumbnails are a
 * progressive enhancement and must not affect the user's checkout success.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string} orderId
 * @param {Array<{ previewImage?: string | null }>} cartSnapshot
 * @param {string[]} itemRowIds
 */
export function backfillOrderThumbnailsInBackground(
    supabase,
    userId,
    orderId,
    cartSnapshot,
    itemRowIds
) {
    if (!userId || !orderId) return;
    if (!Array.isArray(itemRowIds) || itemRowIds.length === 0) return;
    if (!Array.isArray(cartSnapshot) || cartSnapshot.length === 0) return;

    void (async () => {
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
            if (ids.length === 0) return;

            const { error } = await supabase.rpc('patch_order_item_thumbnails', {
                p_item_ids: ids,
                p_thumbnail_urls: urls
            });
            if (error) console.warn('patch_order_item_thumbnails (batch):', error);
        } catch (e) {
            console.warn('Order thumbnails backfill:', e);
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
