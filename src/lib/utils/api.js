// Generic API/RPC retry helper for the FEEL stabilization sprint.
//
// Why this exists:
//   * Network glitches (mobile cell handover, brief Wi-Fi loss, captive portal
//     warm-up) should not surface as user-facing errors when a quick retry
//     would succeed.
//   * Auth/validation errors (401/403/4xx) MUST NOT be retried — that just
//     wastes the user's time and can mask real bugs.
//   * Order-creation timeouts already have a tailored wrapper in
//     orderPlacement.js (with idempotent unique_violation recovery). This
//     module is the *generic* layer those wrappers can compose with.
//
// Public surface:
//   * withRetry(fn, opts) — runs fn up to N times with exponential backoff.
//   * isAuthError(err)    — true for 401/403-shaped Supabase/fetch errors.
//   * isRetriableError(err) — network/timeout/5xx; safe to retry.
//   * sleep(ms)           — small helper used by withRetry, exported for tests.
//
// Design contract (must hold):
//   * On a successful attempt, the resolved value of fn() bubbles up unchanged.
//   * On an unretriable error, the error is thrown immediately (no delay).
//   * Total wall-clock when all retries fail with default delays:
//       attempt#1 → 1s → attempt#2 → 2s → attempt#3 → 4s → attempt#4
//     i.e. up to ~7s of backoff plus the per-attempt latency.
//   * Backoff includes mild jitter (±20%) to avoid thundering-herd retries.

/**
 * Default backoff schedule in ms. Index N is the wait BEFORE attempt N+1.
 * Tweaking this changes total time; keep in sync with docs / UX copy.
 */
const DEFAULT_BACKOFF_MS = [1000, 2000, 4000];

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Adds ±20% jitter so multiple clients retrying in parallel don't pile up on
 * the server at the exact same moment.
 * @param {number} baseMs
 * @returns {number}
 */
function jitter(baseMs) {
    const spread = baseMs * 0.2;
    const delta = (Math.random() * 2 - 1) * spread;
    return Math.max(0, Math.round(baseMs + delta));
}

/**
 * Coerce whatever the caller threw into a uniform shape we can introspect.
 * Supabase RPC errors expose `code` (Postgres) and sometimes `status` (HTTP).
 * Browser fetch errors expose `name` (TypeError) and a textual `message`.
 *
 * @param {unknown} e
 * @returns {{ status: number | null; code: string | null; name: string; message: string; isTimeout: boolean }}
 */
function classify(e) {
    if (!e) return { status: null, code: null, name: '', message: '', isTimeout: false };
    /** @type {any} */
    const err = e;

    let status = null;
    if (typeof err.status === 'number') status = err.status;
    else if (err.response && typeof err.response.status === 'number') status = err.response.status;
    else if (typeof err.statusCode === 'number') status = err.statusCode;

    return {
        status,
        code: typeof err.code === 'string' ? err.code : null,
        name: typeof err.name === 'string' ? err.name : '',
        message: String(err.message || '').toLowerCase(),
        isTimeout: !!err.isTimeout
    };
}

/**
 * Auth failures must short-circuit retries:
 *   * 401: session expired — retrying with the same JWT will keep failing.
 *   * 403: RLS / policy denial — same.
 * Postgres SQLSTATE 42501 (insufficient_privilege) and 28000 (invalid
 * authorization) also count as auth and must not be retried.
 *
 * @param {unknown} e
 * @returns {boolean}
 */
export function isAuthError(e) {
    const c = classify(e);
    if (c.status === 401 || c.status === 403) return true;
    if (c.code === '42501' || c.code === '28000') return true;
    if (c.message.includes('not_authenticated')) return true;
    if (c.message.includes('jwt expired')) return true;
    return false;
}

/**
 * Retriable = the failure happened in transit, not because the request itself
 * was rejected on its merits. Concretely:
 *   * Browser-level network error / abort.
 *   * Explicit timeout (we mark thrown timeouts with err.isTimeout = true).
 *   * HTTP 5xx (server unavailable, gateway, etc.).
 *   * HTTP 408 (request timeout) and 429 (rate limit) — both transient.
 *
 * Everything else (4xx, validation, RPC business errors) is final.
 *
 * @param {unknown} e
 * @returns {boolean}
 */
export function isRetriableError(e) {
    if (!e) return false;
    if (isAuthError(e)) return false;

    const c = classify(e);

    if (c.isTimeout) return true;
    if (c.name === 'AbortError') return true;

    if (c.status != null) {
        if (c.status >= 500 && c.status < 600) return true;
        if (c.status === 408 || c.status === 429) return true;
        return false;
    }

    if (
        c.message.includes('failed to fetch') ||
        c.message.includes('networkerror') ||
        c.message.includes('network error') ||
        c.message.includes('network request failed') ||
        c.message.includes('aborted') ||
        c.message.includes('timeout') ||
        c.message.includes('econnreset') ||
        c.message.includes('etimedout')
    ) {
        return true;
    }

    return false;
}

/**
 * Run an async function with exponential-backoff retries.
 *
 * @template T
 * @param {() => Promise<T>} fn
 *   Must be a no-arg function we can re-invoke. Wrap closures yourself.
 * @param {{
 *   attempts?: number;
 *   backoffMs?: readonly number[];
 *   shouldRetry?: (err: unknown, attempt: number) => boolean;
 *   onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
 *   signal?: AbortSignal;
 * }} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts) {
    const attempts = Math.max(1, opts?.attempts ?? 3);
    const backoff = opts?.backoffMs ?? DEFAULT_BACKOFF_MS;
    const shouldRetry = opts?.shouldRetry ?? isRetriableError;
    const onRetry = opts?.onRetry;
    const signal = opts?.signal;

    let lastErr;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        if (signal?.aborted) {
            throw signal.reason ?? new Error('aborted');
        }

        try {
            return await fn();
        } catch (err) {
            lastErr = err;

            if (attempt >= attempts) break;
            if (!shouldRetry(err, attempt)) break;

            const baseDelay = backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0;
            const delayMs = jitter(baseDelay);

            if (onRetry) {
                try {
                    onRetry(err, attempt, delayMs);
                } catch {
                    /* user-supplied callback must not break the retry loop */
                }
            }

            await sleep(delayMs);
        }
    }

    throw lastErr;
}
