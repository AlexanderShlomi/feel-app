<script>
    import { onMount } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { supabase } from '$lib/supabase';
    import { profile } from '$lib/authStore';

    /** @type {{ order_number?: number|null; status?: string|null; shipping_first_name?: string|null; shipping_last_name?: string|null; shipping_city?: string|null; shipping_street?: string|null; shipping_house_number?: number|null; shipping_apartment_number?: number|null; shipping_notes?: string|null; placed_at?: string|null; total_amount?: number|null; currency?: string|null; gift_enabled?: boolean|null; gift_message?: string|null; gift_sender_name?: string|null } | null} */
    let order = null;
    /** @type {{ title: string | null; quantity: number | null; line_total: number | null }[]} */
    let orderItems = [];
    let loading = true;
    let loadError = '';

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
                } else {
                    orderItems = items ?? [];
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
    <div class="card">
        <div class="hero">
            <div class="hero-visual">
                <!-- עם הרשאת אנימציה: אותו סרטון כמו בעמוד הבית + סימון V -->
                <div class="hero-motion" aria-hidden="true">
                    <video class="hero-loop" autoplay loop muted playsinline preload="none">
                        <source src="/heroImag.mp4" type="video/mp4" />
                    </video>
                    <div class="hero-loop-badge">
                        <svg class="check check-tiny" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path
                                class="check-path"
                                d="M20 38.5L31.2 49.5L52 27"
                                stroke="#C6B29A"
                                stroke-width="6"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            />
                        </svg>
                    </div>
                </div>
                <!-- נגישות: ללא סרטון כשמבקשים הפחתת תנועה -->
                <div class="checkwrap check-fallback" aria-hidden="true">
                    <svg class="check" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                            class="check-path"
                            d="M20 38.5L31.2 49.5L52 27"
                            stroke="#C6B29A"
                            stroke-width="6"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                    </svg>
                </div>
            </div>

            <div class="hero-text">
                <div class="kicker">נחת</div>
                <h1 class="title">תודה {customerName}, הזיכרונות שלך בדרך לייצור.</h1>

                {#if loading}
                    <p class="sub">טוענים את פרטי ההזמנה…</p>
                {:else if loadError}
                    <p class="error" role="alert">{loadError}</p>
                {:else}
                    {#if orderNumber != null}
                        <div class="order-number" aria-label="מספר הזמנה">הזמנה #{orderNumber}</div>
                    {:else}
                        <div class="order-number muted">הזמנה</div>
                    {/if}

                    {#if shippingLines.length}
                        <div class="ship-box" aria-label="כתובת משלוח">
                            <div class="ship-title">כתובת משלוח</div>
                            {#each shippingLines as line}
                                <div class="ship-line">{line}</div>
                            {/each}
                        </div>
                    {/if}

                    {#if orderItems.length && order}
                        <div class="items-box" aria-label="פריטים בהזמנה">
                            <div class="items-title">מה בדרך אליכם</div>
                            {#each orderItems as row}
                                <div class="items-row">
                                    <span class="items-name">{itemLineLabel(row)}</span>
                                    <span class="items-qty">× {Number(row.quantity) || 0}</span>
                                    {#if formatMoney(row.line_total, order.currency)}
                                        <span class="items-price">{formatMoney(row.line_total, order.currency)}</span>
                                    {/if}
                                </div>
                            {/each}
                            {#if formatMoney(order.total_amount, order.currency)}
                                <div class="items-total">סה״כ {formatMoney(order.total_amount, order.currency)}</div>
                            {/if}
                        </div>
                    {/if}
                {/if}
            </div>
        </div>

        <div class="actions">
            <a class="wa-btn" href={whatsappHref} target="_blank" rel="noreferrer">
                שיתוף ההתרגשות בוואטסאפ
            </a>
            <p class="wa-hint">
                ההודעה כוללת קישור לדף הבית של FEEL (עם תצוגת לוגו), קישור לסרטון ההירו ופירוט ההזמנה — מוכן לשליחה.
            </p>

            <div class="nav-row">
                <button type="button" class="nav-btn secondary" on:click={goToEditor}>חזרה ל‑Editor</button>
                <button type="button" class="nav-btn primary" on:click={goToOrders}>לכל ההזמנות שלי</button>
            </div>
        </div>

        <div class="footer-note">
            שומרים עליכם — אפשר תמיד לעקוב אחרי הסטטוס בעמוד “ההזמנות שלי”.
        </div>
    </div>
</div>

<style>
    .success-page {
        min-height: calc(100vh - 70px);
        min-height: calc(100dvh - 70px);
        background: #F2F0EC;
        padding: 26px 16px 40px;
        box-sizing: border-box;
        display: flex;
        justify-content: center;
        align-items: flex-start;
    }

    .card {
        width: 100%;
        max-width: 860px;
        background: #FAF8F5;
        border-radius: 28px;
        border: 1px solid rgba(198, 178, 154, 0.48);
        box-shadow: 0 24px 70px rgba(30, 30, 30, 0.10);
        overflow: hidden;
    }

    .hero {
        display: grid;
        grid-template-columns: 180px 1fr;
        gap: 18px;
        padding: 26px 22px 18px;
        align-items: center;
    }

    .hero-visual {
        width: 140px;
        margin: 0 auto;
        position: relative;
    }

    .hero-motion {
        display: none;
        position: relative;
        width: 140px;
        height: 140px;
        border-radius: 28px;
        overflow: hidden;
        border: 1px solid rgba(198, 178, 154, 0.35);
        box-shadow: 0 12px 32px rgba(30, 30, 30, 0.08);
        background: #1a1a1a;
    }

    .hero-loop {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }

    .hero-loop-badge {
        position: absolute;
        bottom: 8px;
        left: 8px;
        width: 44px;
        height: 44px;
        border-radius: 14px;
        background: rgba(250, 248, 245, 0.94);
        border: 1px solid rgba(198, 178, 154, 0.45);
        display: grid;
        place-items: center;
        box-shadow: 0 6px 16px rgba(30, 30, 30, 0.12);
    }

    .check-tiny {
        width: 26px;
        height: 26px;
        filter: drop-shadow(0 2px 6px rgba(198, 178, 154, 0.35));
    }

    .checkwrap {
        width: 140px;
        height: 140px;
        border-radius: 28px;
        background: radial-gradient(circle at 30% 30%, rgba(198, 178, 154, 0.25), rgba(198, 178, 154, 0.06) 55%, transparent 75%);
        border: 1px solid rgba(198, 178, 154, 0.35);
        display: grid;
        place-items: center;
        margin: 0 auto;
    }

    .check-fallback {
        margin: 0 auto;
    }

    @media (prefers-reduced-motion: no-preference) {
        .hero-motion {
            display: block;
        }
        .check-fallback {
            display: none;
        }
    }

    .check {
        width: 86px;
        height: 86px;
        filter: drop-shadow(0 8px 18px rgba(198, 178, 154, 0.22));
    }

    .check-path {
        stroke-dasharray: 120;
        stroke-dashoffset: 120;
        animation: drawCheck 900ms ease-out 180ms forwards;
    }

    @media (prefers-reduced-motion: reduce) {
        .check-path {
            animation: none;
            stroke-dashoffset: 0;
        }
    }

    @keyframes drawCheck {
        to { stroke-dashoffset: 0; }
    }

    .hero-text { min-width: 0; }

    .kicker {
        font-weight: 900;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        font-size: 12px;
        color: rgba(30, 30, 30, 0.62);
        margin-bottom: 10px;
    }

    .title {
        margin: 0;
        font-size: 28px;
        line-height: 1.25;
        font-weight: 950;
        color: #1E1E1E;
    }

    .sub {
        margin: 12px 0 0;
        font-weight: 800;
        color: rgba(30, 30, 30, 0.68);
    }

    .error {
        margin: 12px 0 0;
        font-weight: 900;
        color: #b91c1c;
        background: rgba(185, 28, 28, 0.08);
        border: 1px solid rgba(185, 28, 28, 0.22);
        padding: 12px 14px;
        border-radius: 16px;
        display: inline-block;
    }

    .order-number {
        margin-top: 14px;
        display: inline-flex;
        align-items: baseline;
        gap: 10px;
        padding: 12px 16px;
        border-radius: 18px;
        background: #1E1E1E;
        color: #F2F0EC;
        font-weight: 1000;
        font-size: 18px;
        letter-spacing: 0.02em;
    }

    .order-number.muted {
        background: rgba(30, 30, 30, 0.10);
        color: rgba(30, 30, 30, 0.85);
    }

    .ship-box {
        margin-top: 14px;
        padding: 14px 16px;
        border-radius: 20px;
        background: rgba(198, 178, 154, 0.12);
        border: 1px solid rgba(198, 178, 154, 0.34);
    }

    .ship-title {
        font-weight: 1000;
        color: #1E1E1E;
        margin-bottom: 8px;
        font-size: 13px;
    }

    .ship-line {
        font-weight: 850;
        color: rgba(30, 30, 30, 0.76);
        font-size: 13px;
        line-height: 1.45;
        margin-bottom: 4px;
    }
    .ship-line:last-child { margin-bottom: 0; }

    .items-box {
        margin-top: 14px;
        padding: 14px 16px;
        border-radius: 20px;
        background: rgba(30, 30, 30, 0.04);
        border: 1px solid rgba(198, 178, 154, 0.28);
    }

    .items-title {
        font-weight: 1000;
        color: #1E1E1E;
        margin-bottom: 10px;
        font-size: 13px;
    }

    .items-row {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 10px;
        align-items: baseline;
        font-size: 13px;
        font-weight: 850;
        color: rgba(30, 30, 30, 0.82);
        padding: 8px 0;
    }

    .items-row + .items-row {
        border-top: 1px solid rgba(198, 178, 154, 0.18);
    }

    .items-name {
        min-width: 0;
        text-align: right;
        line-height: 1.35;
    }

    .items-qty {
        color: rgba(30, 30, 30, 0.55);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }

    .items-price {
        font-weight: 950;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        color: #1E1E1E;
    }

    .items-total {
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid rgba(198, 178, 154, 0.28);
        font-weight: 1000;
        font-size: 15px;
        color: #1E1E1E;
        text-align: right;
        font-variant-numeric: tabular-nums;
    }

    .actions {
        padding: 18px 22px 22px;
        border-top: 1px solid rgba(198, 178, 154, 0.22);
        background: linear-gradient(180deg, rgba(242,240,236,0.0), rgba(242,240,236,0.65));
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .wa-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        text-decoration: none;
        border-radius: 18px;
        padding: 13px 16px;
        font-weight: 1000;
        font-size: 14px;
        background: #C6B29A;
        color: #1E1E1E;
        border: 2px solid rgba(30,30,30,0.06);
        box-shadow: 0 10px 28px rgba(198, 178, 154, 0.35);
        transition: transform 0.18s ease, filter 0.18s ease;
    }
    .wa-btn:hover { transform: translateY(-1px); filter: saturate(1.02) contrast(1.02); }

    .wa-hint {
        margin: -6px 0 0;
        padding: 0 4px;
        font-size: 12px;
        font-weight: 780;
        line-height: 1.45;
        color: rgba(30, 30, 30, 0.52);
        text-align: center;
    }

    .nav-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
    }

    .nav-btn {
        border-radius: 18px;
        padding: 12px 14px;
        font-weight: 1000;
        cursor: pointer;
        border: 1px solid rgba(30,30,30,0.10);
        transition: transform 0.18s ease, background 0.18s ease;
    }

    .nav-btn.primary {
        background: #1E1E1E;
        color: #F2F0EC;
        border-color: rgba(30,30,30,0.16);
    }
    .nav-btn.secondary {
        background: transparent;
        color: #1E1E1E;
        border-color: rgba(198, 178, 154, 0.55);
    }
    .nav-btn:hover { transform: translateY(-1px); }

    .footer-note {
        padding: 14px 22px 18px;
        font-weight: 850;
        color: rgba(30, 30, 30, 0.58);
        font-size: 12px;
        text-align: center;
    }

    @media (max-width: 700px) {
        .hero {
            grid-template-columns: 1fr;
            text-align: right;
        }
        .hero-visual {
            width: 100%;
            max-width: 220px;
        }
        .hero-motion,
        .checkwrap {
            width: 100%;
            max-width: 220px;
            height: 220px;
            margin: 0 auto 0 0;
        }
        .title { font-size: 24px; }
        .nav-row { grid-template-columns: 1fr; }
        .items-row {
            grid-template-columns: 1fr;
            gap: 4px;
        }
        .items-price,
        .items-qty {
            justify-self: end;
        }
    }
</style>

