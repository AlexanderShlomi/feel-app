<script>
    import { onMount } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { supabase } from '$lib/supabase';
    import { profile } from '$lib/authStore';
    import { trackEcommerceOnce } from '$lib/analytics.js';
    import { cookieConsent } from '$lib/consentStore.js';

    /** @type {{ order_number?: number|null; status?: string|null; shipping_first_name?: string|null; shipping_last_name?: string|null; shipping_city?: string|null; shipping_street?: string|null; shipping_house_number?: number|null; shipping_apartment_number?: number|null; shipping_notes?: string|null; placed_at?: string|null; total_amount?: number|null; currency?: string|null; gift_enabled?: boolean|null; gift_message?: string|null; gift_sender_name?: string|null } | null} */
    let order = null;
    /** @type {{ title: string | null; quantity: number | null; line_total: number | null }[]} */
    let orderItems = [];
    let loading = true;
    let loadError = '';
    let itemsLoadFailed = false;

    $: orderId = $page.params.orderId;
    $: siteBase = String($page.data?.siteUrl ?? '')
        .trim()
        .replace(/\/$/, '');
    $: customerName =
        [($profile?.full_name || order?.shipping_first_name), order?.shipping_last_name]
            .filter((x) => typeof x === 'string' && x.trim())
            .join(' ') || 'יקר/ה';

    $: orderNumber = order?.order_number ?? null;

    $: shippingLines = (() => {
        if (!order) return [];
        const lines = [];
        const name = [order.shipping_first_name, order.shipping_last_name].filter(Boolean).join(' ');
        if (name) lines.push(name);
        const street = [order.shipping_street, order.shipping_house_number != null ? String(order.shipping_house_number) : '']
            .filter(Boolean)
            .join(' ');
        if (street) lines.push(street);
        if (order.shipping_apartment_number != null) lines.push(`דירה ${order.shipping_apartment_number}`);
        if (order.shipping_city) lines.push(String(order.shipping_city));
        if (order.shipping_notes) lines.push(String(order.shipping_notes));
        return lines;
    })();

    /** @param {number | string | null | undefined} amount @param {string | null | undefined} currency */
    function formatMoney(amount, currency) {
        const cur = (currency || 'ILS').toUpperCase();
        const n = Number(amount);
        if (!Number.isFinite(n)) return '';
        try {
            return new Intl.NumberFormat('he-IL', {
                style: 'currency',
                currency: cur,
                maximumFractionDigits: cur === 'ILS' ? 0 : 2
            }).format(n);
        } catch {
            return `${n} ${cur}`;
        }
    }

    /** @param {{ title: string | null; quantity: number | null; line_total: number | null }} row */
    function itemLineLabel(row) {
        const t = typeof row.title === 'string' ? row.title.trim() : '';
        return t || 'מגנט מותאם אישית';
    }

    /** כתובת קנונית של האתר לצורך שיתוף ההזמנה (לא תלויה ב־host של בקשת ה־SSR). */
    const SHARE_SITE_URL = 'https://www.feel-ya.com';
    const SHARE_HERO_VIDEO_URL = `${SHARE_SITE_URL}/heroImag.mp4`;

    /** סיכום טקסט להודעת וואטסאפ: קישור לאתר (תצוגת OG עם לוגו), קישור לסרטון ההירו, פירוט הזמנה */
    function buildWhatsappShareText() {
        const parts = [];
        parts.push('וואו! הרגע הזמנתי משהו מרגש ב־FEEL 🎞️✨');
        parts.push('מחכה כבר שהמגנטים יגיעו!');
        parts.push('');

        parts.push('האתר של FEEL — בקישור הבא תופיע תצוגה מקדימה עם הלוגו:');
        parts.push(`${SHARE_SITE_URL}/`);
        parts.push('');
        parts.push('סרטון ההירו מהדף הראשי (קישור ישיר לווידאו):');
        parts.push(SHARE_HERO_VIDEO_URL);
        parts.push('');

        if (!loading && !loadError && order) {
            parts.push('—— פירוט ההזמנה ——');
            if (order.order_number != null) parts.push(`מספר הזמנה: ${order.order_number}`);
            if (order.placed_at) {
                try {
                    const d = new Date(order.placed_at);
                    parts.push(`תאריך: ${new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(d)}`);
                } catch {
                    /* ignore */
                }
            }

            if (orderItems.length) {
                parts.push('פריטים:');
                for (const row of orderItems) {
                    const q = Number(row.quantity) || 0;
                    const label = itemLineLabel(row);
                    const lt = formatMoney(row.line_total, order.currency);
                    parts.push(lt ? `• ${label} × ${q} — ${lt}` : `• ${label} × ${q}`);
                }
            }

            const totalStr = formatMoney(order.total_amount, order.currency);
            if (totalStr) parts.push(`סה״כ: ${totalStr}`);

            if (order.gift_enabled && order.gift_message) {
                const gm = String(order.gift_message).trim().slice(0, 400);
                parts.push('');
                parts.push('מתנה לנמען:');
                parts.push(gm);
                if (order.gift_sender_name) parts.push(`מאת: ${String(order.gift_sender_name).trim()}`);
            }
            parts.push('');
        }

        parts.push('ניפגש ב־FEEL 💛');
        return parts.join('\n');
    }

    $: whatsappHref = `https://wa.me/?text=${encodeURIComponent(buildWhatsappShareText())}`;

    async function loadOrder() {
        loadError = '';
        loading = true;
        orderItems = [];
        try {
            const { data, error } = await supabase
                .from('orders')
                .select(
                    [
                        'order_number',
                        'status',
                        'placed_at',
                        'shipping_first_name',
                        'shipping_last_name',
                        'shipping_city',
                        'shipping_street',
                        'shipping_house_number',
                        'shipping_apartment_number',
                        'shipping_notes',
                        'total_amount',
                        'currency',
                        'gift_enabled',
                        'gift_message',
                        'gift_sender_name'
                    ].join(', ')
                )
                .eq('id', orderId)
                .maybeSingle();

            if (error) throw error;
            if (!data) {
                loadError = 'לא מצאנו את ההזמנה. בדקו את הקישור ונסו שוב.';
                order = null;
                orderItems = [];
            } else {
                order = data;
                const { data: items, error: itemsErr } = await supabase
                    .from('order_items')
                    .select('title, quantity, line_total')
                    .eq('order_id', orderId)
                    .order('created_at', { ascending: true });

                if (itemsErr) {
                    console.error('Load order_items:', itemsErr);
                    orderItems = [];
                    // לא מודדים רכישה עם items חסרים — הטעינה המוצלחת הבאה תמדוד
                    itemsLoadFailed = true;
                } else {
                    orderItems = items ?? [];
                    itemsLoadFailed = false;
                }
            }
        } catch (e) {
            console.error('Load success order:', e);
            loadError = 'לא הצלחנו לטעון את פרטי ההזמנה. נסו שוב.';
            order = null;
            orderItems = [];
        } finally {
            loading = false;
        }
    }

    /* מדידת רכישה — ריאקטיבי כדי להמתין גם להכרעת הסכמה (באנר בביקור ראשון) וגם
       לטעינת ההזמנה. trackEcommerceOnce נועל (localStorage, חוצה סשנים/טאבים) רק
       אחרי שהאירוע נדחף בפועל, כך שהסכמה מאוחרת לא מאבדת את ה-conversion. ללא PII. */
    $: if (order && !loading && !itemsLoadFailed && $cookieConsent.decided) {
        trackPurchaseOnce();
    }

    function trackPurchaseOnce() {
        // שער סטטוס: לא מודדים הזמנה שטרם שולמה או שבוטלה (רלוונטי למשפך Tranzila pending→paid)
        if (order.status === 'pending' || order.status === 'cancelled') return;
        trackEcommerceOnce(
            `purchase_${orderId}`,
            'purchase',
            {
                // מזהה קנוני יחיד (UUID של ההזמנה) — עקבי בין טעינות, בסיס לדה-דופ ב-GA
                transaction_id: orderId,
                value: Number(order.total_amount) || 0,
                currency: order.currency || 'ILS',
                items: (orderItems || []).map((it) => ({
                    item_id: it.title || 'item',
                    item_name: it.title || 'item',
                    price: Number(it.line_total) || 0,
                    quantity: it.quantity ?? 1
                }))
            },
            { persistent: true }
        );
    }

    function goToOrders() {
        goto('/orders');
    }

    function goToEditor() {
        goto('/uploader');
    }

    onMount(() => {
        if (!orderId) {
            loadError = 'חסר מזהה הזמנה.';
            loading = false;
            return;
        }
        void loadOrder();
    });
</script>

<svelte:head>
    <title>תודה! | feel</title>
</svelte:head>

<div class="success-page" dir="rtl" lang="he">

    <!-- ── Celebration hero ── -->
    <section class="celebration" aria-label="אישור הזמנה">
        <div class="confetti" aria-hidden="true">
            <span class="dot dot1"></span>
            <span class="dot dot2"></span>
            <span class="dot dot3"></span>
            <span class="dot dot4"></span>
            <span class="dot dot5"></span>
            <span class="dot dot6"></span>
        </div>

        <div class="check-circle" aria-hidden="true">
            <svg class="check-svg" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                    class="check-path"
                    d="M20 38.5L31.2 49.5L52 27"
                    stroke="#C6B29A"
                    stroke-width="5.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
        </div>

        <div class="kicker">נחת</div>
        <div class="gold-accent-line" aria-hidden="true"></div>
        <h1 class="headline">תודה {customerName}</h1>
        <p class="subheadline">הזיכרונות שלך בדרך לייצור</p>
    </section>

    <!-- ── Order badge ── -->
    {#if !loading && !loadError && orderNumber != null}
        <div class="order-badge" aria-label="מספר הזמנה">
            <span class="badge-chip">הזמנה #{orderNumber}</span>
        </div>
    {:else if loading}
        <div class="order-badge">
            <span class="badge-chip skeleton-badge"></span>
        </div>
    {/if}

    <!-- ── Details card ── -->
    {#if loading}
        <div class="details-card skeleton-card" aria-busy="true">
            <div class="sk-line sk-wide"></div>
            <div class="sk-line sk-medium"></div>
            <div class="sk-divider"></div>
            <div class="sk-line sk-wide"></div>
            <div class="sk-line sk-narrow"></div>
            <div class="sk-line sk-medium"></div>
        </div>
    {:else if loadError}
        <div class="details-card error-card" role="alert">
            <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p class="error-text">{loadError}</p>
            <button type="button" class="retry-btn" on:click={loadOrder}>נסה שוב</button>
        </div>
    {:else if order}
        <div class="details-card">
            {#if shippingLines.length}
                <div class="detail-section">
                    <div class="detail-title">
                        <!-- Map pin -->
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C6B29A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
                            <circle cx="12" cy="10" r="3"/>
                        </svg>
                        כתובת משלוח
                    </div>
                    {#each shippingLines as line}
                        <div class="detail-line">{line}</div>
                    {/each}
                </div>
            {/if}

            {#if shippingLines.length && orderItems.length}
                <div class="detail-divider" aria-hidden="true"></div>
            {/if}

            {#if orderItems.length}
                <div class="detail-section">
                    <div class="detail-title">
                        <!-- Package icon -->
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C6B29A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <polyline points="21 8 21 21 3 21 3 8"/>
                            <rect x="1" y="3" width="22" height="5"/>
                            <line x1="10" y1="12" x2="14" y2="12"/>
                        </svg>
                        מה בדרך אליכם
                    </div>
                    <div class="items-grid">
                        {#each orderItems as row}
                            <div class="item-row">
                                <span class="item-name">{itemLineLabel(row)}</span>
                                <span class="item-qty">× {Number(row.quantity) || 0}</span>
                                {#if formatMoney(row.line_total, order.currency)}
                                    <span class="item-price">{formatMoney(row.line_total, order.currency)}</span>
                                {/if}
                            </div>
                        {/each}
                    </div>

                    {#if formatMoney(order.total_amount, order.currency)}
                        <div class="detail-total">
                            <span class="total-label">סה״כ</span>
                            <span class="total-amount">{formatMoney(order.total_amount, order.currency)}</span>
                        </div>
                    {/if}
                </div>
            {/if}

            {#if order.gift_enabled && order.gift_message}
                {#if shippingLines.length || orderItems.length}
                    <div class="detail-divider" aria-hidden="true"></div>
                {/if}
                <div class="gift-callout">
                    <!-- Gift icon -->
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C6B29A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <polyline points="20 12 20 22 4 22 4 12"/>
                        <rect x="2" y="7" width="20" height="5"/>
                        <line x1="12" y1="22" x2="12" y2="7"/>
                        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
                        <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
                    </svg>
                    <div class="gift-body">
                        <div class="gift-message">{order.gift_message}</div>
                        {#if order.gift_sender_name}
                            <div class="gift-sender">מאת: {order.gift_sender_name}</div>
                        {/if}
                    </div>
                </div>
            {/if}
        </div>
    {/if}

    <!-- ── Share ── -->
    <section class="share-section">
        <a class="whatsapp-btn" href={whatsappHref} target="_blank" rel="noreferrer">
            <!-- WhatsApp icon -->
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#1E1E1E" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
            </svg>
            שיתוף ההתרגשות בוואטסאפ
        </a>
        <p class="share-hint">ההודעה כוללת קישור לדף הבית של FEEL ופירוט ההזמנה — מוכן לשליחה.</p>
    </section>

    <!-- ── Navigation ── -->
    <section class="secondary-section">
        <div class="nav-row">
            <button type="button" class="nav-btn primary" on:click={goToOrders}>לכל ההזמנות שלי</button>
            <button type="button" class="nav-btn secondary" on:click={goToEditor}>חזרה ל‑Editor</button>
        </div>
        <p class="footer-note">שומרים עליכם — אפשר תמיד לעקוב אחרי הסטטוס בעמוד "ההזמנות שלי".</p>
    </section>

</div>

<style>
    /* ── Page shell ── */
    .success-page {
        min-height: calc(100vh - 70px);
        min-height: calc(100dvh - 70px);
        background: #F2F0EC;
        padding: 32px 16px 56px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        max-width: 560px;
        margin: 0 auto;
        width: 100%;
    }

    /* ── Celebration section ── */
    .celebration {
        width: 100%;
        text-align: center;
        padding: 36px 24px 32px;
        background: radial-gradient(ellipse at 50% 30%, rgba(198,178,154,0.10) 0%, transparent 68%);
        position: relative;
        overflow: hidden;
        opacity: 0;
        transform: translateY(12px);
        animation: fadeUp 500ms ease-out 50ms forwards;
    }

    /* ── Confetti ── */
    .confetti {
        position: absolute;
        inset: 0;
        pointer-events: none;
    }

    .dot {
        position: absolute;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        opacity: 0;
        animation: floatUp 2s ease-out forwards;
    }

    .dot1 { background: rgba(198,178,154,0.85); top: 55%; left: 20%; animation-delay: 0.6s; width: 6px; height: 6px; }
    .dot2 { background: rgba(198,178,154,0.55); top: 60%; left: 35%; animation-delay: 0.9s; }
    .dot3 { background: rgba(63,82,79,0.30); top: 50%; left: 52%; animation-delay: 0.7s; width: 7px; height: 7px; }
    .dot4 { background: rgba(198,178,154,0.70); top: 58%; left: 68%; animation-delay: 1.1s; width: 5px; height: 5px; }
    .dot5 { background: rgba(198,178,154,0.45); top: 52%; left: 80%; animation-delay: 0.8s; }
    .dot6 { background: rgba(63,82,79,0.25); top: 62%; left: 12%; animation-delay: 1.0s; width: 6px; height: 6px; }

    @keyframes floatUp {
        0%   { opacity: 0; transform: translateY(0); }
        20%  { opacity: 1; }
        100% { opacity: 0; transform: translateY(-38px); }
    }

    /* ── Check circle ── */
    .check-circle {
        width: 120px;
        height: 120px;
        border-radius: 50%;
        background: rgba(198,178,154,0.15);
        border: 2px solid rgba(198,178,154,0.35);
        display: grid;
        place-items: center;
        margin: 0 auto 20px;
        opacity: 0;
        transform: scale(0.8);
        animation: popIn 400ms ease-out 100ms forwards;
    }

    .check-svg {
        width: 72px;
        height: 72px;
        filter: drop-shadow(0 6px 16px rgba(198,178,154,0.28));
    }

    .check-path {
        stroke-dasharray: 120;
        stroke-dashoffset: 120;
        animation: drawCheck 900ms ease-out 500ms forwards;
    }

    /* ── Kicker + separator ── */
    .kicker {
        font-weight: 900;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        font-size: 16px;
        color: #C6B29A;
        margin-bottom: 12px;
    }

    .gold-accent-line {
        width: 48px;
        height: 2px;
        background: #C6B29A;
        margin: 0 auto 18px;
        border-radius: 2px;
    }

    .headline {
        margin: 0 0 10px;
        font-size: 36px;
        line-height: 1.2;
        font-weight: 950;
        color: #1E1E1E;
    }

    .subheadline {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        color: rgb(71,81,96);
        line-height: 1.4;
    }

    /* ── Order badge ── */
    .order-badge {
        opacity: 0;
        animation: fadeUp 400ms ease-out 300ms forwards;
    }

    .badge-chip {
        display: inline-block;
        background: #1E1E1E;
        color: #F2F0EC;
        font-size: 22px;
        font-weight: 900;
        letter-spacing: 0.02em;
        padding: 10px 22px;
        border-radius: 100px;
    }

    .skeleton-badge {
        width: 160px;
        height: 44px;
        background: rgba(30,30,30,0.08);
        color: transparent;
        animation: shimmer 1.4s infinite;
    }

    /* ── Details card ── */
    .details-card {
        width: 100%;
        background: #FFFFFF;
        border: 1px solid rgba(198,178,154,0.22);
        border-radius: 20px;
        box-shadow: 0 4px 20px rgba(30,30,30,0.06);
        padding: 20px;
        box-sizing: border-box;
        opacity: 0;
        animation: fadeUp 400ms ease-out 450ms forwards;
    }

    .skeleton-card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: #FFFFFF;
    }

    .sk-line {
        height: 14px;
        border-radius: 8px;
        background: rgba(30,30,30,0.07);
        animation: shimmer 1.4s infinite;
    }
    .sk-wide  { width: 80%; }
    .sk-medium{ width: 55%; }
    .sk-narrow{ width: 35%; }
    .sk-divider{ height: 1px; background: rgba(198,178,154,0.2); margin: 4px 0; }

    @keyframes shimmer {
        0%   { opacity: 0.6; }
        50%  { opacity: 1; }
        100% { opacity: 0.6; }
    }

    /* ── Error card ── */
    .error-card {
        text-align: center;
        padding: 28px 20px;
        animation: fadeUp 400ms ease-out 300ms forwards;
    }

    .error-icon {
        width: 40px;
        height: 40px;
        margin: 0 auto 12px;
        display: block;
    }

    .error-text {
        margin: 0 0 18px;
        font-weight: 800;
        color: #b91c1c;
        font-size: 15px;
        line-height: 1.4;
    }

    .retry-btn {
        background: #1E1E1E;
        color: #F2F0EC;
        border: none;
        border-radius: 14px;
        padding: 12px 24px;
        font-weight: 900;
        font-size: 15px;
        cursor: pointer;
        transition: transform 0.18s ease;
    }
    .retry-btn:hover { transform: translateY(-1px); }

    /* ── Detail sections ── */
    .detail-section { display: flex; flex-direction: column; gap: 6px; }

    .detail-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 15px;
        font-weight: 800;
        color: #1E1E1E;
        margin-bottom: 4px;
    }

    .detail-divider {
        height: 1px;
        background: rgba(198,178,154,0.28);
        margin: 14px 0;
    }

    .detail-line {
        font-size: 15px;
        font-weight: 700;
        color: rgb(71,81,96);
        line-height: 1.45;
    }

    /* ── Items grid ── */
    .items-grid { display: flex; flex-direction: column; gap: 0; }

    .item-row {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 12px;
        align-items: baseline;
        font-size: 15px;
        font-weight: 700;
        color: rgb(71,81,96);
        padding: 9px 0;
        border-bottom: 1px solid rgba(198,178,154,0.15);
    }
    .item-row:last-child { border-bottom: none; }

    .item-name { min-width: 0; text-align: right; line-height: 1.35; }
    .item-qty  { color: rgba(30,30,30,0.50); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .item-price{ font-size: 16px; font-weight: 900; color: #1E1E1E; font-variant-numeric: tabular-nums; white-space: nowrap; }

    /* ── Total strip ── */
    .detail-total {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        background: rgba(198,178,154,0.08);
        border-radius: 12px;
        padding: 12px 14px;
        margin-top: 10px;
    }

    .total-label {
        font-size: 15px;
        font-weight: 800;
        color: #1E1E1E;
    }

    .total-amount {
        font-size: 20px;
        font-weight: 950;
        color: #1E1E1E;
        font-variant-numeric: tabular-nums;
    }

    /* ── Gift callout ── */
    .gift-callout {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        background: rgba(198,178,154,0.06);
        border: 1px solid rgba(198,178,154,0.22);
        border-radius: 14px;
        padding: 14px;
    }

    .gift-callout svg { flex-shrink: 0; margin-top: 2px; }

    .gift-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }

    .gift-message {
        font-size: 15px;
        font-weight: 700;
        color: rgb(71,81,96);
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .gift-sender {
        font-size: 13px;
        font-weight: 800;
        color: rgba(30,30,30,0.55);
    }

    /* ── Share section ── */
    .share-section {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        opacity: 0;
        animation: fadeUp 400ms ease-out 550ms forwards;
    }

    .whatsapp-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        width: 100%;
        text-decoration: none;
        border-radius: 18px;
        padding: 15px 20px;
        font-weight: 900;
        font-size: 17px;
        background: #C6B29A;
        color: #1E1E1E;
        border: none;
        box-shadow: 0 8px 24px rgba(198,178,154,0.40);
        transition: transform 0.18s ease, filter 0.18s ease;
    }
    .whatsapp-btn:hover { transform: translateY(-2px); filter: saturate(1.04) contrast(1.02); }

    .share-hint {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
        color: rgba(30,30,30,0.45);
        text-align: center;
        line-height: 1.45;
        padding: 0 8px;
    }

    /* ── Secondary nav ── */
    .secondary-section {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        opacity: 0;
        animation: fadeUp 400ms ease-out 650ms forwards;
    }

    .nav-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        width: 100%;
    }

    .nav-btn {
        border-radius: 18px;
        padding: 13px 16px;
        font-size: 15px;
        font-weight: 900;
        cursor: pointer;
        transition: transform 0.18s ease;
        line-height: 1.2;
    }
    .nav-btn:hover { transform: translateY(-1px); }

    .nav-btn.primary {
        background: rgb(63,82,79);
        color: #FFFFFF;
        border: none;
    }

    .nav-btn.secondary {
        background: transparent;
        color: #1E1E1E;
        border: 1px solid rgba(198,178,154,0.65);
    }

    .footer-note {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
        color: rgba(30,30,30,0.38);
        text-align: center;
        line-height: 1.5;
    }

    /* ── Animations ── */
    @keyframes popIn {
        to { opacity: 1; transform: scale(1); }
    }

    @keyframes drawCheck {
        to { stroke-dashoffset: 0; }
    }

    @keyframes fadeUp {
        to { opacity: 1; transform: translateY(0); }
    }

    /* ── Reduced motion ── */
    @media (prefers-reduced-motion: reduce) {
        .celebration,
        .order-badge,
        .details-card,
        .share-section,
        .secondary-section {
            animation: none;
            opacity: 1;
            transform: none;
        }
        .check-circle {
            animation: none;
            opacity: 1;
            transform: none;
        }
        .check-path {
            animation: none;
            stroke-dashoffset: 0;
        }
        .dot { animation: none; opacity: 0; }
    }

    /* ── Mobile ── */
    @media (max-width: 640px) {
        .success-page { padding: 20px 12px 48px; gap: 14px; }
        .celebration  { padding: 28px 16px 26px; }
        .headline     { font-size: 28px; }
        .check-circle { width: 100px; height: 100px; }
        .check-svg    { width: 58px; height: 58px; }
        .subheadline  { font-size: 16px; }
        .nav-row      { grid-template-columns: 1fr; }
        .item-row     { grid-template-columns: 1fr auto; gap: 8px; }
        .item-price   { grid-column: 2; }
        .item-qty     { grid-column: 2; }
    }
</style>
