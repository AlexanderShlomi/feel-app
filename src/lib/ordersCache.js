const SESSION_PREFIX = 'feel_orders:';
const REFRESH_SIGNAL_PREFIX = 'feel_orders_refresh:';

/**
 * @param {string} userId
 */
export function ordersSessionKey(userId) {
    return `${SESSION_PREFIX}${userId}`;
}

/**
 * A short-lived signal used to tell /orders to bypass caches and silently refresh from DB.
 * @param {string} userId
 */
export function ordersRefreshSignalKey(userId) {
    return `${REFRESH_SIGNAL_PREFIX}${userId}`;
}

/**
 * @param {string} userId
 */
export function clearOrdersSessionCacheForUser(userId) {
    if (typeof sessionStorage === 'undefined') return;
    try {
        sessionStorage.removeItem(ordersSessionKey(userId));
    } catch {
        /* ignore */
    }
}

export function clearAllOrdersSessionCache() {
    if (typeof sessionStorage === 'undefined') return;
    try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith(SESSION_PREFIX)) sessionStorage.removeItem(k);
            if (k && k.startsWith(REFRESH_SIGNAL_PREFIX)) sessionStorage.removeItem(k);
        }
    } catch {
        /* ignore */
    }
}

/**
 * Called from checkout right after payment confirmation succeeds.
 * Writes a refresh signal and clears cached orders snapshot for the user.
 *
 * @param {{ userId: string; orderId?: string | null; expectedStatus?: string; ts?: number }} args
 */
export function invalidateOrdersAfterCheckout(args) {
    const userId = args?.userId;
    if (!userId) return;

    clearOrdersSessionCacheForUser(userId);
    if (typeof sessionStorage === 'undefined') return;

    try {
        const payload = {
            userId,
            orderId: args?.orderId ?? null,
            expectedStatus: args?.expectedStatus ?? 'paid',
            ts: typeof args?.ts === 'number' ? args.ts : Date.now()
        };
        sessionStorage.setItem(ordersRefreshSignalKey(userId), JSON.stringify(payload));
    } catch {
        /* ignore */
    }
}

/**
 * Read + consume refresh signal.
 * @param {string} userId
 * @param {number} maxAgeMs
 * @returns {{ userId: string; orderId: string | null; expectedStatus: string; ts: number } | null}
 */
export function consumeOrdersRefreshSignal(userId, maxAgeMs = 120_000) {
    if (typeof sessionStorage === 'undefined') return null;
    try {
        const raw = sessionStorage.getItem(ordersRefreshSignalKey(userId));
        if (!raw) return null;
        sessionStorage.removeItem(ordersRefreshSignalKey(userId));
        const o = JSON.parse(raw);
        if (!o || o.userId !== userId) return null;
        if (typeof o.ts !== 'number' || Date.now() - o.ts > maxAgeMs) return null;
        return {
            userId,
            orderId: typeof o.orderId === 'string' ? o.orderId : null,
            expectedStatus: typeof o.expectedStatus === 'string' ? o.expectedStatus : 'paid',
            ts: o.ts
        };
    } catch {
        return null;
    }
}

