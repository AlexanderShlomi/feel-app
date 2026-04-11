<script>
    import { onMount } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { supabase } from '$lib/supabase';
    import { profile } from '$lib/authStore';

    /** @type {{ order_number?: number|null; status?: string|null; shipping_first_name?: string|null; shipping_last_name?: string|null; shipping_city?: string|null; shipping_street?: string|null; shipping_house_number?: number|null; shipping_apartment_number?: number|null; shipping_notes?: string|null; placed_at?: string|null } | null} */
    let order = null;
    let loading = true;
    let loadError = '';

    $: orderId = $page.params.orderId;
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

    const WHATSAPP_TEXT_BASE = 'וואו! הרגע יצרתי משהו מרגש ב-FEEL. מחכה כבר שהמגנטים שלי יגיעו! ';
    // 🎞️✨ => %F0%9F%8E%9E%EF%B8%8F%E2%9C%A8
    const WHATSAPP_TEXT_EMOJI_ENCODED = '%F0%9F%8E%9E%EF%B8%8F%E2%9C%A8';

    $: whatsappHref = `https://wa.me/?text=${encodeURIComponent(WHATSAPP_TEXT_BASE)}${WHATSAPP_TEXT_EMOJI_ENCODED}`;

    async function loadOrder() {
        loadError = '';
        loading = true;
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
                        'shipping_notes'
                    ].join(', ')
                )
                .eq('id', orderId)
                .maybeSingle();

            if (error) throw error;
            if (!data) {
                loadError = 'לא מצאנו את ההזמנה. בדקו את הקישור ונסו שוב.';
                order = null;
            } else {
                order = data;
            }
        } catch (e) {
            console.error('Load success order:', e);
            loadError = 'לא הצלחנו לטעון את פרטי ההזמנה. נסו שוב.';
            order = null;
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
            <div class="checkwrap" aria-hidden="true">
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
                {/if}
            </div>
        </div>

        <div class="actions">
            <a class="wa-btn" href={whatsappHref} target="_blank" rel="noreferrer">
                שיתוף ההתרגשות בוואטסאפ
            </a>

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
        min-height: calc(100dvh - 70px);
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
        .checkwrap { margin: 0; }
        .title { font-size: 24px; }
        .nav-row { grid-template-columns: 1fr; }
    }
</style>

