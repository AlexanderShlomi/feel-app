<script>
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
     *   order_items: Array<{
     *     id: string;
     *     title: string;
     *     subtitle: string | null;
     *     thumbnail_url: string | null;
     *     quantity: number;
     *     line_total: number;
     *   }>;
     * }>} */
    let orders = [];

    let listLoading = true;
    let loadError = '';

    let fetchSeq = 0;
    /** מונע ריצה כפולה כש־onAuthStateChange מחליף את אובייקט ה־user עם אותו id */
    let lastLoadedForUserId = /** @type {string | null} */ (null);

    const STATUS_LABEL = {
        pending: 'ממתין לתשלום',
        paid: 'שולם',
        processing: 'בטיפול',
        cancelled: 'בוטל'
    };

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

    /**
     * שאילתה נפרדת ל-order_items עם select('*') — נמנע כשל אם עמודת thumbnail_url
     * עדיין לא הופעלה בפרויקט Supabase, ונמנע בעיות join ב-PostgREST.
     */
    async function fetchOrdersForUser(userId) {
        const seq = ++fetchSeq;
        listLoading = true;
        loadError = '';

        const { data: orderRows, error: ordersError } = await supabase
            .from('orders')
            .select('id, order_number, status, placed_at, total_amount, currency, gift_enabled')
            .eq('user_id', userId)
            .order('placed_at', { ascending: false });

        if (ordersError) {
            if (seq !== fetchSeq) return;
            loadError = ordersError.message || 'שגיאה בטעינת ההזמנות';
            orders = [];
            listLoading = false;
            return;
        }

        const rows = orderRows || [];
        const ids = rows.map((o) => o.id);

        /** @type {Record<string, Record<string, unknown>[]>} */
        const itemsByOrder = {};

        if (ids.length > 0) {
            const { data: itemRows, error: itemsError } = await supabase
                .from('order_items')
                .select('*')
                .in('order_id', ids);

            if (itemsError) {
                if (seq !== fetchSeq) return;
                loadError = itemsError.message || 'שגיאה בטעינת שורות ההזמנה';
                orders = [];
                listLoading = false;
                return;
            }

            for (const row of itemRows || []) {
                const oid = row.order_id;
                if (typeof oid !== 'string') continue;
                if (!itemsByOrder[oid]) itemsByOrder[oid] = [];
                itemsByOrder[oid].push(row);
            }
        }

        if (seq !== fetchSeq) return;

        orders = rows.map((o) => ({
            ...o,
            order_items: itemsByOrder[o.id] || []
        }));
        listLoading = false;
    }

    /** טעינה אחרי ש-auth הסתיים — נגזר מ־$authLoading ו־$user (לא מ־onMount בלבד). */
    $: if ($authLoading) {
        listLoading = true;
    } else if ($user?.id) {
        const uid = $user.id;
        if (uid !== lastLoadedForUserId) {
            lastLoadedForUserId = uid;
            void fetchOrdersForUser(uid);
        }
    } else {
        lastLoadedForUserId = null;
        fetchSeq += 1;
        orders = [];
        listLoading = false;
        loadError = '';
    }

    function retryFetch() {
        const u = get(user);
        if (u?.id) void fetchOrdersForUser(u.id);
    }
</script>

<svelte:head>
    <title>ההזמנות שלי | FEEL</title>
</svelte:head>

<div class="orders-page" dir="rtl">
    <div class="orders-inner">
        <h1 class="orders-title">ההזמנות שלי</h1>

        {#if $authLoading || listLoading}
            <p class="orders-muted" aria-busy="true">טוען…</p>
        {:else if !$user}
            <p class="orders-lead">התחברו כדי לראות את ההיסטוריה שלכם.</p>
            <a class="orders-cta" href="/checkout">לתשלום / התחברות</a>
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
                        <div class="order-card-head">
                            <div class="order-meta">
                                {#if o.order_number != null}
                                    <span class="order-public-num">הזמנה #{o.order_number}</span>
                                {/if}
                                <span class="order-date">{formatDate(o.placed_at)}</span>
                                <span class="order-status" data-status={o.status}>
                                    {STATUS_LABEL[o.status] ?? o.status}
                                </span>
                            </div>
                            <div class="order-total">
                                ₪{Number(o.total_amount || 0).toLocaleString('he-IL')}
                                <span class="order-currency">{o.currency || 'ILS'}</span>
                            </div>
                        </div>
                        {#if o.gift_enabled}
                            <div class="gift-badge">מתנה</div>
                        {/if}
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
                                        <div class="line-price">
                                            ₪{Number(line.line_total || 0).toLocaleString('he-IL')}
                                            {#if line.quantity && line.quantity > 1}
                                                <span class="line-qty">×{line.quantity}</span>
                                            {/if}
                                        </div>
                                    </div>
                                </li>
                            {/each}
                        </ul>
                    </li>
                {/each}
            </ul>
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
    }

    .order-card-head {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
    }

    .order-meta {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .order-public-num {
        display: block;
        font-weight: 800;
        font-size: 1.05rem;
        color: var(--color-header-blue);
        margin-bottom: 6px;
        letter-spacing: 0.02em;
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

    .order-total {
        font-size: 1.25rem;
        font-weight: 800;
        color: var(--color-dark-blue);
    }

    .order-currency {
        font-size: 0.75rem;
        font-weight: 600;
        opacity: 0.65;
        margin-inline-start: 4px;
    }

    .gift-badge {
        display: inline-block;
        margin-bottom: 10px;
        font-size: 0.8rem;
        font-weight: 700;
        padding: 3px 10px;
        border-radius: 8px;
        background: #e0f2f1;
        color: #00695c;
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
</style>
