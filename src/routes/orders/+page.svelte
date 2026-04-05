<script>
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { supabase } from '$lib/supabase';
    import { user, authLoading } from '$lib/authStore';

    /** @type {Array<{
     *   id: string;
     *   order_number?: number;
     *   status: string;
     *   placed_at: string;
     *   total_amount: number;
     *   currency: string;
     *   gift_enabled: boolean;
     *   gift_message?: string | null;
     *   gift_sender_name?: string | null;
     *   gift_sender_phone?: string | null;
     *   subtotal_amount?: number;
     *   discount_amount?: number;
     *   coupon_code?: string | null;
     *   shipping_method?: string;
     *   shipping_amount?: number;
     *   shipping_first_name?: string;
     *   shipping_last_name?: string;
     *   shipping_city?: string;
     *   shipping_street?: string;
     *   shipping_house_number?: number;
     *   shipping_apartment_number?: number | null;
     *   shipping_notes?: string | null;
     *   order_items: Array<{
     *     id: string;
     *     title: string;
     *     subtitle: string | null;
     *     thumbnail_url: string | null;
     *     quantity: number;
     *     line_total: number;
     *     unit_price?: number;
     *   }>;
     * }>} */
    let orders = [];

    let listLoading = true;
    let loadError = '';

    let fetchSeq = 0;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let loadDebounceTimer = null;

    /** עמוד קטן = פחות JSON ופחות עומס DB/RAM לכל משתמש */
    const ORDERS_PAGE_SIZE = 25;
    /** 0 = בלי עיכוב מלאכותי אחרי auth */
    const LOAD_DEBOUNCE_MS = 0;
    const ORDERS_CACHE_TTL_MS = 60_000;
    const SESSION_ORDERS_MAX_MS = 600_000;
    const SESSION_REVALIDATE_AFTER_MS = 15_000;

    /** @param {string} uid */
    function sessionOrdersKey(uid) {
        return `feel_orders:${uid}`;
    }

    /**
     * @param {string} userId
     * @returns {{ rows: typeof orders; hasMore: boolean; ts: number } | null}
     */
    function readSessionOrdersCache(userId) {
        if (typeof sessionStorage === 'undefined') return null;
        try {
            const raw = sessionStorage.getItem(sessionOrdersKey(userId));
            if (!raw) return null;
            const o = JSON.parse(raw);
            if (o.userId !== userId) return null;
            if (Date.now() - o.ts > SESSION_ORDERS_MAX_MS) return null;
            if (!Array.isArray(o.rows)) return null;
            return { rows: o.rows, hasMore: !!o.hasMore, ts: o.ts };
        } catch {
            return null;
        }
    }

    /**
     * @param {string} userId
     * @param {typeof orders} snapshot
     * @param {boolean} hasMore
     */
    function persistOrdersSnapshot(userId, snapshot, hasMore) {
        if (typeof sessionStorage === 'undefined') return;
        try {
            const rows = snapshot.map((o) => ({
                ...o,
                order_items: Array.isArray(o.order_items) ? [...o.order_items] : []
            }));
            sessionStorage.setItem(
                sessionOrdersKey(userId),
                JSON.stringify({ userId, ts: Date.now(), rows, hasMore })
            );
        } catch {
            /* quota / private mode */
        }
    }

    /** @param {string} userId */
    function clearSessionOrdersForUser(userId) {
        if (typeof sessionStorage === 'undefined') return;
        try {
            sessionStorage.removeItem(sessionOrdersKey(userId));
        } catch {
            /* */
        }
    }

    function clearAllSessionOrdersCache() {
        if (typeof sessionStorage === 'undefined') return;
        try {
            for (let i = sessionStorage.length - 1; i >= 0; i--) {
                const k = sessionStorage.key(i);
                if (k && k.startsWith('feel_orders:')) sessionStorage.removeItem(k);
            }
        } catch {
            /* */
        }
    }

    let ordersHasMore = false;
    let listLoadingMore = false;
    let loadMoreError = '';
    let loadMoreSeq = 0;

    /** @type {string | null} */
    let ordersCacheUserId = null;
    let ordersCacheAt = 0;
    /** @type {typeof orders} */
    let ordersCacheData = [];

    function invalidateOrdersCache() {
        ordersCacheUserId = null;
        ordersCacheAt = 0;
        ordersCacheData = [];
    }

    /**
     * @param {string} userId
     * @returns {typeof orders | null}
     */
    function peekOrdersCache(userId) {
        if (ordersCacheUserId !== userId) return null;
        if (Date.now() - ordersCacheAt > ORDERS_CACHE_TTL_MS) return null;
        return ordersCacheData;
    }

    /**
     * מטמון רק כשכל הרשימה נכנסת לעמוד הראשון (אין עוד עמודים) — נמנע מצב "חצי רשימה ישנה".
     * @param {string} userId
     * @param {typeof orders} data
     * @param {boolean} hasMore
     */
    function putOrdersCache(userId, data, hasMore) {
        if (hasMore) {
            invalidateOrdersCache();
            return;
        }
        ordersCacheUserId = userId;
        ordersCacheAt = Date.now();
        ordersCacheData = data.map((o) => ({
            ...o,
            order_items: Array.isArray(o.order_items) ? [...o.order_items] : []
        }));
    }

    /**
     * @param {unknown} data
     * @returns {unknown[]}
     */
    function normalizeRpcBlocks(data) {
        if (data == null) return [];
        if (Array.isArray(data)) return data;
        if (typeof data === 'string') {
            try {
                const p = JSON.parse(data);
                return Array.isArray(p) ? p : [];
            } catch {
                return [];
            }
        }
        return [];
    }

    /**
     * @param {unknown} data
     * @returns {typeof orders}
     */
    function mapRpcToOrders(data) {
        const blocks = normalizeRpcBlocks(data);
        /** @type {typeof orders} */
        const out = [];
        for (const b of blocks) {
            if (!b || typeof b !== 'object') continue;
            const rec = /** @type {Record<string, unknown>} */ (b);
            const ordRaw = rec.order && typeof rec.order === 'object' ? rec.order : {};
            const ord = /** @type {Record<string, unknown>} */ (ordRaw);
            const rawItems = Array.isArray(rec.order_items) ? rec.order_items : [];
            const itemObjs = rawItems
                .filter((x) => x && typeof x === 'object')
                .map((x) => /** @type {Record<string, unknown>} */ (x));
            out.push(
                /** @type {(typeof orders)[number]} */ ({
                    ...ord,
                    order_items: sortOrderLines(itemObjs)
                })
            );
        }
        return out;
    }

    const STATUS_LABEL = {
        pending: 'ממתין לתשלום',
        paid: 'שולם',
        processing: 'בטיפול',
        cancelled: 'בוטל'
    };

    const SHIPPING_METHOD_LABEL = {
        home_delivery_free: 'משלוח עד הבית'
    };

    /**
     * @param {Record<string, unknown>} o
     */
    function shippingMethodLabel(o) {
        const m = o?.shipping_method;
        if (typeof m !== 'string' || !m) return '';
        return SHIPPING_METHOD_LABEL[/** @type {keyof typeof SHIPPING_METHOD_LABEL} */ (m)] ?? m;
    }

    /**
     * @param {Record<string, unknown>} o
     */
    function formatShippingAddress(o) {
        const lines = [];
        const name = [o.shipping_first_name, o.shipping_last_name].filter(Boolean).join(' ');
        if (name) lines.push(name);
        const street = o.shipping_street;
        const num = o.shipping_house_number;
        if (street || num != null) {
            lines.push([street, num != null ? String(num) : ''].filter(Boolean).join(' '));
        }
        if (o.shipping_apartment_number != null) {
            lines.push(`דירה ${o.shipping_apartment_number}`);
        }
        if (o.shipping_city) lines.push(String(o.shipping_city));
        if (o.shipping_notes) lines.push(String(o.shipping_notes));
        return lines;
    }

    /**
     * @param {unknown} v
     */
    function numVal(v) {
        if (v == null) return 0;
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : 0;
    }

    function formatDate(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleString('he-IL', {
                dateStyle: 'medium',
                timeStyle: 'short'
            });
        } catch {
            return iso;
        }
    }

    function sortOrderLines(lines) {
        return [...lines].sort((a, b) => {
            const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
            const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
            return ta - tb;
        });
    }

    /**
     * גיבוי: שתי שאילתות (ללא RPC) — אם המיגרציה עדיין לא הורצה בענן.
     * @param {string} userId
     * @param {number} offset
     * @param {number} takeCount כמה שורות הזמנה לבקש (כולל +1 לזיהוי hasMore)
     */
    async function fetchOrdersLegacy(userId, offset, takeCount) {
        const { data: orderRows, error: ordersError } = await supabase
            .from('orders')
            .select(
                [
                    'id',
                    'order_number',
                    'status',
                    'placed_at',
                    'total_amount',
                    'currency',
                    'gift_enabled',
                    'gift_message',
                    'gift_sender_name',
                    'gift_sender_phone',
                    'subtotal_amount',
                    'discount_amount',
                    'coupon_code',
                    'shipping_method',
                    'shipping_amount',
                    'shipping_first_name',
                    'shipping_last_name',
                    'shipping_city',
                    'shipping_street',
                    'shipping_house_number',
                    'shipping_apartment_number',
                    'shipping_notes'
                ].join(', ')
            )
            .eq('user_id', userId)
            .order('placed_at', { ascending: false })
            .range(offset, offset + takeCount - 1);

        if (ordersError) throw new Error(ordersError.message || 'שגיאה בטעינת ההזמנות');

        const rows = orderRows || [];
        const ids = rows.map((o) => o.id);

        /** @type {Record<string, Record<string, unknown>[]>} */
        const itemsByOrder = {};

        if (ids.length > 0) {
            const { data: itemRows, error: itemsError } = await supabase
                .from('order_items')
                .select(
                    'id, order_id, title, subtitle, thumbnail_url, quantity, line_total, unit_price, created_at'
                )
                .in('order_id', ids);

            if (itemsError) throw new Error(itemsError.message || 'שגיאה בטעינת שורות ההזמנה');

            for (const row of itemRows || []) {
                const oid = row.order_id;
                if (typeof oid !== 'string') continue;
                if (!itemsByOrder[oid]) itemsByOrder[oid] = [];
                itemsByOrder[oid].push(row);
            }
        }

        return rows.map((o) => ({
            ...o,
            order_items: sortOrderLines(itemsByOrder[o.id] || [])
        }));
    }

    /**
     * RPC + מטמון זיכרון + sessionStorage (ציור מיידי בחזרה לדף).
     * silent: ריענון ברקע בלי שלד — רק כשיש לכל היותר עמוד אחד בזיכרון.
     */
    async function fetchOrdersForUser(
        userId,
        /** @type {{ force?: boolean; silent?: boolean }} */ opts = {}
    ) {
        const force = !!opts.force;
        const silent = !!opts.silent;

        if (!force && !silent) {
            const hit = peekOrdersCache(userId);
            if (hit) {
                orders = hit.map((o) => ({
                    ...o,
                    order_items: Array.isArray(o.order_items) ? [...o.order_items] : []
                }));
                ordersHasMore = false;
                loadError = '';
                listLoading = false;
                return;
            }

            const ss = readSessionOrdersCache(userId);
            if (ss) {
                orders = ss.rows.map((o) => ({
                    ...o,
                    order_items: Array.isArray(o.order_items) ? [...o.order_items] : []
                }));
                ordersHasMore = ss.hasMore;
                loadError = '';
                listLoading = false;
                const age = Date.now() - ss.ts;
                if (age < SESSION_REVALIDATE_AFTER_MS) return;
                if (orders.length <= ORDERS_PAGE_SIZE) {
                    void fetchOrdersForUser(userId, { silent: true });
                }
                return;
            }
        }

        if (silent && orders.length > ORDERS_PAGE_SIZE) return;

        const seq = ++fetchSeq;

        if (!silent) {
            listLoading = true;
            loadMoreError = '';
            ordersHasMore = false;
        }
        loadError = '';

        const want = ORDERS_PAGE_SIZE + 1;

        try {
            const { data, error: rpcError } = await supabase.rpc('my_orders_dashboard', {
                p_max_orders: want,
                p_offset: 0
            });

            /** @type {typeof orders} */
            let mapped;
            if (!rpcError) {
                mapped = mapRpcToOrders(data);
            } else {
                mapped = await fetchOrdersLegacy(userId, 0, want);
            }

            if (seq !== fetchSeq) return;

            const hasMore = mapped.length > ORDERS_PAGE_SIZE;
            const pageRows = hasMore ? mapped.slice(0, ORDERS_PAGE_SIZE) : mapped;

            orders = pageRows;
            ordersHasMore = hasMore;
            putOrdersCache(userId, pageRows, hasMore);
            persistOrdersSnapshot(userId, pageRows, hasMore);
            loadError = '';
        } catch (e) {
            if (seq !== fetchSeq) return;
            if (!silent) {
                const msg = e instanceof Error ? e.message : String(e);
                loadError = msg || 'שגיאה בטעינת ההזמנות';
                orders = [];
                ordersHasMore = false;
            }
        } finally {
            if (seq === fetchSeq && !silent) listLoading = false;
        }
    }

    async function loadMoreOrders() {
        const u = get(user);
        if (!u?.id || !ordersHasMore || listLoadingMore || listLoading) return;

        const seq = ++loadMoreSeq;
        loadMoreError = '';
        listLoadingMore = true;

        const offset = orders.length;
        const want = ORDERS_PAGE_SIZE + 1;

        try {
            const { data, error: rpcError } = await supabase.rpc('my_orders_dashboard', {
                p_max_orders: want,
                p_offset: offset
            });

            /** @type {typeof orders} */
            let mapped;
            if (!rpcError) {
                mapped = mapRpcToOrders(data);
            } else {
                mapped = await fetchOrdersLegacy(u.id, offset, want);
            }

            if (seq !== loadMoreSeq) return;

            const hasMore = mapped.length > ORDERS_PAGE_SIZE;
            const pageRows = hasMore ? mapped.slice(0, ORDERS_PAGE_SIZE) : mapped;

            const merged = [...orders, ...pageRows];
            orders = merged;
            ordersHasMore = hasMore;
            invalidateOrdersCache();
            persistOrdersSnapshot(u.id, merged, hasMore);
        } catch (e) {
            if (seq !== loadMoreSeq) return;
            loadMoreError = e instanceof Error ? e.message : String(e);
        } finally {
            if (seq === loadMoreSeq) listLoadingMore = false;
        }
    }

    /** אורח: ביטול טעינה בתנועה + איפוס מצב (לא ממתינים ל־fetch שכבר לא רלוונטי) */
    $: if (!$authLoading && !$user) {
        if (loadDebounceTimer != null) {
            clearTimeout(loadDebounceTimer);
            loadDebounceTimer = null;
        }
        fetchSeq += 1;
        loadMoreSeq += 1;
        invalidateOrdersCache();
        clearAllSessionOrdersCache();
        orders = [];
        ordersHasMore = false;
        listLoadingMore = false;
        loadMoreError = '';
        listLoading = false;
        loadError = '';
    }

    /**
     * Debounce: מניעת שתי fetch סמוכות מ־authLoading + user שמבטלות זו את זו ולפעמים משאירות ריק.
     */
    onMount(() => {
        let disposed = false;
        function tickLoad() {
            if (disposed) return;
            if (loadDebounceTimer != null) clearTimeout(loadDebounceTimer);
            loadDebounceTimer = setTimeout(() => {
                loadDebounceTimer = null;
                if (disposed) return;
                if (get(authLoading)) return;
                const u = get(user);
                if (!u?.id) return;
                void fetchOrdersForUser(u.id);
            }, LOAD_DEBOUNCE_MS);
        }
        const unsubAuth = authLoading.subscribe(() => tickLoad());
        const unsubUser = user.subscribe(() => tickLoad());
        tickLoad();
        return () => {
            disposed = true;
            if (loadDebounceTimer != null) clearTimeout(loadDebounceTimer);
            unsubAuth();
            unsubUser();
        };
    });

    function retryFetch() {
        invalidateOrdersCache();
        const u = get(user);
        if (u?.id) clearSessionOrdersForUser(u.id);
        if (u?.id) void fetchOrdersForUser(u.id, { force: true });
    }
</script>

<svelte:head>
    <title>ההזמנות שלי | FEEL</title>
</svelte:head>

<div class="orders-page" dir="rtl" lang="he">
    <div class="orders-inner">
        <h1 class="orders-title">ההזמנות שלי</h1>

        {#if $authLoading}
            <p class="orders-muted" aria-busy="true">טוען…</p>
        {:else if !$user}
            <p class="orders-lead">התחברו כדי לראות את ההיסטוריה שלכם.</p>
            <a class="orders-cta" href="/checkout">לתשלום / התחברות</a>
        {:else if listLoading}
            <div class="orders-skeleton-wrap" aria-busy="true" aria-label="טוען הזמנות">
                <p class="skeleton-hint">טוען הזמנות…</p>
                <div class="skeleton-card"></div>
                <div class="skeleton-card"></div>
                <div class="skeleton-card short"></div>
            </div>
        {:else if loadError}
            <p class="orders-error" role="alert">{loadError}</p>
            <button type="button" class="orders-retry" on:click={retryFetch}>נסו שוב</button>
        {:else if orders.length === 0}
            <p class="orders-muted">עדיין אין הזמנות. כשתשלימו רכישה, היא תופיע כאן.</p>
            <a class="orders-cta" href="/uploader">ליצירה</a>
        {:else}
            <ul class="order-list">
                {#each orders as o (o.id)}
                    <li class="order-card">
                        <div class="order-card-summary">
                            <div class="order-meta">
                                {#if o.order_number != null}
                                    <span class="order-public-num">הזמנה #{o.order_number}</span>
                                {:else}
                                    <span class="order-public-num muted">הזמנה</span>
                                {/if}
                                <span class="order-date">{formatDate(o.placed_at)}</span>
                                <span class="order-status" data-status={o.status}>
                                    {STATUS_LABEL[o.status] ?? o.status}
                                </span>
                            </div>
                            <div class="order-card-total">
                                <span class="order-total-label">סה״כ</span>
                                <span class="order-total-amount" dir="ltr"
                                    >₪{Number(o.total_amount || 0).toLocaleString('he-IL')}</span
                                >
                                <span class="order-total-currency" dir="ltr">{o.currency || 'ILS'}</span>
                            </div>
                        </div>

                        <h3 class="order-section-title">פריטים</h3>
                        <ul class="order-lines">
                            {#each o.order_items || [] as line (line.id)}
                                <li class="order-line">
                                    <div class="line-thumb">
                                        {#if line.thumbnail_url}
                                            <img
                                                src={line.thumbnail_url}
                                                alt=""
                                                loading="lazy"
                                                decoding="async"
                                            />
                                        {:else}
                                            <span class="line-thumb-fallback" aria-hidden="true">—</span>
                                        {/if}
                                    </div>
                                    <div class="line-body">
                                        <div class="line-title">{line.title}</div>
                                        {#if line.subtitle}
                                            <div class="line-subtitle">{line.subtitle}</div>
                                        {/if}
                                        {#if line.quantity && line.quantity > 1 && line.unit_price != null}
                                            <div class="line-unit">
                                                מחיר ליחידה:
                                                <span class="num-ltr" dir="ltr"
                                                    >₪{Number(line.unit_price).toLocaleString('he-IL')}</span
                                                >
                                            </div>
                                        {/if}
                                        <div class="line-price">
                                            <span class="num-ltr" dir="ltr"
                                                >₪{Number(line.line_total || 0).toLocaleString('he-IL')}</span
                                            >
                                            {#if line.quantity && line.quantity > 1}
                                                <span class="line-qty">×{line.quantity}</span>
                                            {/if}
                                        </div>
                                    </div>
                                </li>
                            {/each}
                        </ul>

                        {#if shippingMethodLabel(o) || formatShippingAddress(o).length}
                            <h3 class="order-section-title">משלוח</h3>
                            <div class="order-ship-box">
                                {#if shippingMethodLabel(o)}
                                    <div class="order-ship-line strong">
                                        {shippingMethodLabel(o)}
                                    </div>
                                {/if}
                                {#each formatShippingAddress(o) as line}
                                    <div class="order-ship-line">{line}</div>
                                {/each}
                            </div>
                        {/if}

                        {#if o.gift_enabled}
                            <h3 class="order-section-title">מתנה</h3>
                            {#if o.gift_message || o.gift_sender_name || o.gift_sender_phone}
                                <div class="gift-detail">
                                    {#if o.gift_message}
                                        <p class="gift-msg">{o.gift_message}</p>
                                    {/if}
                                    {#if o.gift_sender_name}
                                        <p class="gift-meta"><strong>מאת:</strong> {o.gift_sender_name}</p>
                                    {/if}
                                    {#if o.gift_sender_phone}
                                        <p class="gift-meta">
                                            <strong>טלפון:</strong>
                                            <span class="num-ltr" dir="ltr">{o.gift_sender_phone}</span>
                                        </p>
                                    {/if}
                                </div>
                            {:else}
                                <p class="gift-inline-note">הזמנה סומנה כמתנה.</p>
                            {/if}
                        {/if}

                        <h3 class="order-section-title">פירוט תשלום</h3>
                        <div class="order-totals">
                            <div class="totals-row">
                                <span>סכום ביניים</span>
                                <span class="num-ltr" dir="ltr"
                                    >₪{numVal(o.subtotal_amount).toLocaleString('he-IL')}</span
                                >
                            </div>
                            {#if numVal(o.discount_amount) > 0}
                                <div class="totals-row totals-discount">
                                    <span
                                        >הנחה{#if o.coupon_code}
                                            ({o.coupon_code}){/if}</span
                                    >
                                    <span class="num-ltr" dir="ltr"
                                        >−₪{numVal(o.discount_amount).toLocaleString('he-IL')}</span
                                    >
                                </div>
                            {/if}
                            {#if numVal(o.shipping_amount) > 0}
                                <div class="totals-row">
                                    <span>משלוח</span>
                                    <span class="num-ltr" dir="ltr"
                                        >₪{numVal(o.shipping_amount).toLocaleString('he-IL')}</span
                                    >
                                </div>
                            {/if}
                            <div class="totals-row totals-grand">
                                <span>סה״כ לתשלום</span>
                                <span class="num-ltr" dir="ltr"
                                    >₪{Number(o.total_amount || 0).toLocaleString('he-IL')}</span
                                >
                            </div>
                            <div class="totals-currency" dir="ltr">{o.currency || 'ILS'}</div>
                        </div>
                    </li>
                {/each}
            </ul>
            {#if ordersHasMore}
                <div class="orders-load-more">
                    {#if loadMoreError}
                        <p class="orders-load-more-error" role="alert">{loadMoreError}</p>
                    {/if}
                    <button
                        type="button"
                        class="orders-load-more-btn"
                        disabled={listLoadingMore}
                        on:click={loadMoreOrders}
                    >
                        {listLoadingMore ? 'טוען…' : 'טען הזמנות נוספות'}
                    </button>
                </div>
            {/if}
        {/if}
    </div>
</div>

<style>
    .orders-page {
        min-height: calc(100vh - 70px);
        min-height: calc(100dvh - 70px);
        background: var(--color-canvas-bg);
        padding: 24px 16px 48px;
        box-sizing: border-box;
    }

    .orders-inner {
        max-width: 720px;
        margin: 0 auto;
    }

    .orders-title {
        margin: 0 0 20px;
        font-size: 1.75rem;
        font-weight: 800;
        color: var(--color-dark-blue);
    }

    .orders-muted {
        color: var(--color-dark-gray);
        margin: 0;
    }

    .orders-lead {
        margin: 0 0 16px;
        color: var(--color-dark-blue);
        font-size: 1.05rem;
    }

    .orders-error {
        color: #b00020;
        margin: 0 0 12px;
    }

    .orders-cta,
    .orders-retry {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 12px 20px;
        border-radius: 12px;
        font-weight: 700;
        text-decoration: none;
        border: none;
        cursor: pointer;
        font-size: 1rem;
    }

    .orders-cta {
        background: var(--color-dark-blue);
        color: #fff;
    }

    .orders-cta:hover {
        opacity: 0.92;
    }

    .orders-retry {
        background: transparent;
        color: var(--color-dark-blue);
        border: 1px solid color-mix(in srgb, var(--color-gold) 45%, #ccc);
    }

    .orders-load-more {
        margin-top: 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
    }

    .orders-load-more-error {
        margin: 0;
        color: #b00020;
        font-size: 0.9rem;
        text-align: center;
    }

    .orders-load-more-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 220px;
        padding: 12px 24px;
        border-radius: 12px;
        font-weight: 700;
        font-size: 1rem;
        cursor: pointer;
        border: 1px solid color-mix(in srgb, var(--color-gold) 45%, #ccc);
        background: #fff;
        color: var(--color-dark-blue);
    }

    .orders-load-more-btn:hover:not(:disabled) {
        background: var(--color-canvas-bg);
    }

    .orders-load-more-btn:disabled {
        opacity: 0.65;
        cursor: not-allowed;
    }

    .order-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 18px;
    }

    .order-card {
        background: #fff;
        border-radius: 18px;
        border: 1px solid color-mix(in srgb, var(--color-gold) 35%, transparent);
        box-shadow: 0 8px 28px rgba(30, 30, 30, 0.06);
        padding: 18px 16px;
        box-sizing: border-box;
        text-align: start;
    }

    .order-card-summary {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 14px;
        align-items: start;
        margin-bottom: 16px;
        padding-bottom: 14px;
        border-bottom: 1px solid rgba(198, 178, 154, 0.22);
    }

    .order-meta {
        display: flex;
        flex-direction: column;
        gap: 6px;
        align-items: flex-start;
        min-width: 0;
    }

    .order-card-total {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        flex-shrink: 0;
    }

    .order-total-label {
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--color-dark-gray);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .order-total-amount {
        font-size: 1.35rem;
        font-weight: 800;
        color: var(--color-dark-blue);
        line-height: 1.2;
    }

    .order-total-currency {
        font-size: 0.72rem;
        font-weight: 600;
        color: var(--color-dark-gray);
        opacity: 0.75;
    }

    .order-section-title {
        margin: 18px 0 10px;
        font-size: 0.82rem;
        font-weight: 800;
        color: var(--color-header-blue);
        letter-spacing: 0.03em;
        text-transform: uppercase;
    }

    .order-card > .order-section-title:first-of-type {
        margin-top: 0;
    }

    .order-public-num {
        display: block;
        font-weight: 800;
        font-size: 1.05rem;
        color: var(--color-header-blue);
        margin-bottom: 6px;
        letter-spacing: 0.02em;
    }

    .order-public-num.muted {
        color: var(--color-dark-gray);
    }

    .order-date {
        font-weight: 700;
        color: var(--color-dark-blue);
    }

    .order-status {
        display: inline-block;
        font-size: 0.85rem;
        font-weight: 700;
        padding: 4px 10px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--color-gold) 22%, #f5f2ed);
        color: var(--color-header-blue);
        width: fit-content;
    }

    .order-status[data-status='paid'],
    .order-status[data-status='processing'] {
        background: color-mix(in srgb, #2e7d32 18%, #e8f5e9);
        color: #1b5e20;
    }

    .order-status[data-status='cancelled'] {
        background: #fce4ec;
        color: #880e4f;
    }

    .order-ship-box {
        margin-top: 0;
        padding: 12px 14px;
        background: var(--color-canvas-bg);
        border-radius: 12px;
        border: 1px solid rgba(198, 178, 154, 0.35);
    }

    .order-ship-line {
        font-size: 0.95rem;
        color: var(--color-dark-gray);
        margin-bottom: 4px;
        text-align: start;
    }

    .order-ship-line.strong {
        font-weight: 700;
        color: var(--color-dark-blue);
        margin-bottom: 8px;
    }

    .order-ship-line:last-child {
        margin-bottom: 0;
    }

    .gift-inline-note {
        margin: 0;
        font-size: 0.95rem;
        color: var(--color-dark-gray);
    }

    .gift-detail {
        margin: 0;
        padding: 10px 12px;
        background: #e8f5e9;
        border-radius: 10px;
        border: 1px solid #c8e6c9;
        text-align: start;
    }

    .gift-detail .gift-msg {
        margin: 0 0 8px;
        color: var(--color-dark-blue);
    }

    .gift-detail .gift-meta {
        margin: 0 0 4px;
        font-size: 0.9rem;
        color: var(--color-dark-gray);
    }

    .order-lines {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .order-line {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        padding-top: 12px;
        border-top: 1px solid rgba(198, 178, 154, 0.25);
    }

    .order-line:first-child {
        border-top: none;
        padding-top: 0;
    }

    .line-thumb {
        width: 72px;
        height: 72px;
        border-radius: 12px;
        overflow: hidden;
        flex-shrink: 0;
        background: var(--color-canvas-bg);
        border: 1px solid rgba(198, 178, 154, 0.35);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .line-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .line-thumb-fallback {
        color: #999;
        font-size: 1.25rem;
    }

    .line-body {
        flex: 1;
        min-width: 0;
        text-align: start;
    }

    .num-ltr {
        unicode-bidi: isolate;
    }

    .line-title {
        font-weight: 700;
        color: var(--color-dark-blue);
    }

    .line-subtitle {
        font-size: 0.9rem;
        color: var(--color-dark-gray);
        margin-top: 2px;
    }

    .line-unit {
        font-size: 0.85rem;
        color: var(--color-dark-gray);
        margin-top: 4px;
    }

    .line-price {
        margin-top: 6px;
        font-weight: 700;
        color: var(--color-header-blue);
    }

    .line-qty {
        font-weight: 600;
        font-size: 0.85rem;
        opacity: 0.8;
        margin-inline-start: 6px;
    }

    .order-totals {
        margin-top: 14px;
        padding-top: 14px;
        border-top: 1px solid rgba(198, 178, 154, 0.25);
    }

    .totals-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        font-size: 0.95rem;
        margin-bottom: 6px;
        color: var(--color-dark-gray);
        text-align: start;
    }

    .totals-row > span:first-child {
        flex: 1;
        min-width: 0;
        padding-inline-end: 8px;
    }

    .totals-discount {
        color: #6d4c41;
    }

    .totals-grand {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(198, 178, 154, 0.35);
        font-weight: 800;
        font-size: 1.15rem;
        color: var(--color-dark-blue);
    }

    .totals-currency {
        font-size: 0.75rem;
        font-weight: 600;
        opacity: 0.65;
        margin-top: 4px;
        text-align: start;
    }

    .orders-skeleton-wrap {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .skeleton-hint {
        margin: 0 0 4px;
        color: var(--color-dark-gray);
        font-size: 0.95rem;
    }

    .skeleton-card {
        height: 120px;
        border-radius: 18px;
        background: linear-gradient(
            90deg,
            #e8e4de 0%,
            #f2efe9 45%,
            #e8e4de 90%
        );
        background-size: 200% 100%;
        animation: orders-shimmer 1.1s ease-in-out infinite;
    }

    .skeleton-card.short {
        height: 72px;
    }

    @keyframes orders-shimmer {
        0% {
            background-position: 100% 0;
        }
        100% {
            background-position: -100% 0;
        }
    }
</style>
