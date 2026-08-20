<script>
    /**
     * דף הסליקה של טרנזילה, מוטמע ב-checkout.
     *
     * חוזה האירועים זהה ל-PaymentMock כדי שנקודת הקריאה ב-checkout לא תשתנה:
     *   on:approved — רמז בלבד שהמשתמש סיים בהצלחה בצד טרנזילה. אסור להסיק
     *                 ממנו שהחיוב עבר; מי שמכריע זה tranzila-notify בשרת,
     *                 ו-checkout מריץ polling על סטטוס ההזמנה (Law D).
     *   on:failed   — טרנזילה דחתה או שהמשתמש נכשל. ההזמנה נשארת pending.
     *   on:ready    — דף הסליקה נטען (משמש ל-add_payment_info, Law E).
     *
     * הקומפוננטה לא רואה ולא נוגעת בפרטי כרטיס — הם נשארים בתוך ה-iframe של
     * טרנזילה, בדומיין שלהם. זה מה ששומר אותנו ב-PCI SAQ-A.
     */
    import { createEventDispatcher, onMount, onDestroy } from 'svelte';
    import { supabase } from '$lib/supabase';
    import {
        createTranzilaPaymentSession,
        tranzilaPaymentErrorMessage
    } from '$lib/orderPlacement.js';
    import { getConsentSnapshot } from '$lib/analytics.js';
    import { env as publicEnv } from '$env/dynamic/public';

    export let orderId = /** @type {string | null} */ (null);
    /** מספר הזמנה ציבורי (order_number); UUID נשאר ב-orderId לפעולות פנימיות */
    export let orderNumber = /** @type {number | null} */ (null);
    export let amount = 0;

    /**
     * 'iframe'   — דף הסליקה מוטמע בעמוד (ברירת מחדל, שומר על הקונטקסט).
     * 'redirect' — ניווט מלא לטרנזילה וחזרה. נדרש אם טרנזילה חוסמת הטמעה.
     */
    export let mode = /** @type {'iframe' | 'redirect'} */ ('iframe');

    const dispatch = createEventDispatcher();

    /** loading -> ready -> (approved | failed) | error */
    let state = 'loading';
    let paymentUrl = '';
    let errorText = '';
    /** מצב בדיקה (tranmode=V): אימות כרטיס בלי חיוב בפועל */
    let verifyOnly = false;
    /** @type {HTMLIFrameElement | null} */
    let frameEl = null;
    let frameLoaded = false;

    function formatShekel(value) {
        const n = Number(value || 0);
        return n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    async function initSession() {
        if (!orderId) return;
        state = 'loading';
        errorText = '';
        try {
            const session = await createTranzilaPaymentSession(
                supabase,
                orderId,
                getConsentSnapshot()
            );
            paymentUrl = session.paymentUrl;
            verifyOnly = session.tranmode === 'V';
            if (session.orderNumber != null) orderNumber = session.orderNumber;
            state = 'ready';
        } catch (e) {
            console.error('[tranzila] payment init failed:', {
                message: /** @type {any} */ (e)?.message
            });
            errorText = tranzilaPaymentErrorMessage(e);
            state = 'error';
            dispatch('failed', { orderId, stage: 'init' });
        }
    }

    /**
     * דף החזרה מוגש מ-Edge Function, כלומר מהדומיין של Supabase ולא משלנו
     * (טרנזילה מחזירה ב-POST חוצה-מקורות ש-SvelteKit חוסם — ראו tranzila-return).
     * לכן ה-origin המותר הוא של הפונקציות, ולא window.location.origin.
     *
     * הבדיקה החזקה כאן היא השנייה: ההודעה חייבת להגיע בדיוק מה-iframe שאנחנו
     * הצבנו. בלי זה כל טאב או iframe אחר יכול לשלוח "success" מזויף ולהתחיל
     * polling מיותר. גם אם מישהו יעקוף את שתיהן הוא לא ירוויח דבר — ה-polling
     * רק קורא את הסטטוס מהשרת, שנקבע אך ורק ב-tranzila-notify (Law D).
     */
    const FUNCTIONS_ORIGIN = (() => {
        try {
            return new URL(publicEnv.PUBLIC_SUPABASE_URL ?? '').origin;
        } catch {
            return '';
        }
    })();

    /** @param {MessageEvent} event */
    function handleMessage(event) {
        const allowed = [FUNCTIONS_ORIGIN, window.location.origin].filter(Boolean);
        if (!allowed.includes(event.origin)) return;
        if (frameEl && event.source !== frameEl.contentWindow) return;

        const data = /** @type {any} */ (event.data);
        if (!data || data.type !== 'feel:payment') return;
        if (data.orderId && orderId && data.orderId !== orderId) return;

        if (data.status === 'success') {
            state = 'approved';
            /* רמז בלבד — checkout הוא זה שיריץ polling מול השרת. */
            dispatch('approved', { orderId });
        } else {
            state = 'failed';
            dispatch('failed', { orderId, stage: 'gateway' });
        }
    }

    function handleFrameLoad() {
        if (frameLoaded) return;
        frameLoaded = true;
        dispatch('ready', { orderId });
    }

    function goToGateway() {
        if (!paymentUrl) return;
        dispatch('ready', { orderId });
        window.location.href = paymentUrl;
    }

    function retry() {
        paymentUrl = '';
        frameLoaded = false;
        initSession();
    }

    onMount(() => {
        window.addEventListener('message', handleMessage);
        initSession();
    });

    onDestroy(() => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('message', handleMessage);
        }
    });
</script>

<div class="tranzila-payment">
    <div class="payment-inner">
        <div class="payment-header">
            <div class="payment-badge">תשלום מאובטח</div>
            <div class="payment-title">סליקה מאובטחת בתקן PCI DSS</div>
        </div>

        <div class="payment-amount">
            <span class="label">סכום לתשלום</span>
            <span class="value">₪{formatShekel(amount)}</span>
        </div>

        <div class="payment-meta">
            <div class="meta-row">
                <span class="k">מספר הזמנה</span>
                <span class="v order-number-display" dir="ltr">
                    {#if orderNumber != null}
                        #{orderNumber}
                    {:else}
                        <span class="order-num-pending">—</span>
                    {/if}
                </span>
            </div>
        </div>

        {#if verifyOnly}
            <p class="verify-note">מצב בדיקה: הכרטיס מאומת בלבד, לא מתבצע חיוב.</p>
        {/if}

        {#if state === 'loading'}
            <div class="skeleton-wrap" aria-live="polite" aria-busy="true">
                <div class="skeleton-line wide"></div>
                <div class="skeleton-line"></div>
                <div class="skeleton-line"></div>
                <div class="skeleton-text">מכינים את דף התשלום…</div>
            </div>
        {:else if state === 'error'}
            <div class="error-box" role="alert">{errorText}</div>
            <button class="pay-btn gold" type="button" on:click={retry}>נסו שוב</button>
        {:else if state === 'failed'}
            <div class="error-box" role="alert">
                החיוב לא אושר. ההזמנה נשמרה ולא חויבתם — אפשר לנסות שוב עם כרטיס אחר.
            </div>
            <button class="pay-btn gold" type="button" on:click={retry}>תשלום נוסף</button>
        {:else if mode === 'redirect'}
            <button class="pay-btn gold" type="button" on:click={goToGateway}>
                מעבר לתשלום מאובטח
            </button>
            <p class="hint">תועברו לדף הסליקה של טרנזילה ותחזרו לכאן בסיום.</p>
        {:else}
            <div class="frame-wrap" class:is-loading={!frameLoaded}>
                {#if !frameLoaded}
                    <div class="frame-skeleton" aria-hidden="true">
                        <div class="skeleton-line wide"></div>
                        <div class="skeleton-line"></div>
                        <div class="skeleton-line"></div>
                    </div>
                {/if}
                <iframe
                    bind:this={frameEl}
                    src={paymentUrl}
                    title="דף תשלום מאובטח"
                    on:load={handleFrameLoad}
                    allow="payment"
                    referrerpolicy="no-referrer"
                ></iframe>
            </div>
            <p class="hint">
                פרטי האשראי נמסרים ישירות לחברת הסליקה טרנזילה ואינם נשמרים אצלנו.
            </p>
        {/if}
    </div>
</div>

<style>
    .tranzila-payment {
        width: 100%;
        background: #fff;
        border-radius: 28px;
        padding: 22px;
        border: 1px solid rgba(0, 0, 0, 0.06);
        direction: rtl;
        box-sizing: border-box;
    }

    .payment-inner {
        display: flex;
        flex-direction: column;
        gap: 14px;
        align-items: center;
        text-align: center;
    }

    .payment-header {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: center;
    }

    .payment-badge {
        display: inline-flex;
        padding: 8px 16px;
        border-radius: 999px;
        background: rgba(198, 178, 154, 0.16);
        border: 1px solid rgba(198, 178, 154, 0.45);
        color: #1e1e1e;
        font-weight: 800;
        font-size: 14px;
    }

    .payment-title {
        color: #1e1e1e;
        font-weight: 900;
        font-size: 18px;
        letter-spacing: 0.2px;
    }

    .payment-amount {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 6px;
        align-items: center;
    }

    .payment-amount .label {
        color: #6b7280;
        font-weight: 700;
        font-size: 14px;
    }

    .payment-amount .value {
        color: #c6b29a;
        font-weight: 950;
        font-size: 40px;
        line-height: 1;
    }

    .payment-meta {
        width: 100%;
        max-width: 520px;
        background: #f2f0ec;
        border: 1px solid rgba(198, 178, 154, 0.22);
        border-radius: 20px;
        padding: 14px 16px;
        box-sizing: border-box;
        overflow: hidden;
    }

    .meta-row {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: baseline;
        min-width: 0;
    }

    .meta-row .k {
        color: #1e1e1e;
        font-weight: 800;
        flex: 0 0 auto;
    }

    .meta-row .v {
        color: #1e1e1e;
        font-weight: 700;
        font-size: 13px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 65%;
        min-width: 0;
        direction: ltr;
        text-align: left;
        unicode-bidi: plaintext;
    }

    .order-number-display {
        font-size: 1.35rem;
        font-weight: 900;
        letter-spacing: 0.03em;
    }

    .order-num-pending {
        opacity: 0.45;
        font-weight: 700;
    }

    .verify-note {
        margin: 0;
        padding: 8px 14px;
        border-radius: 999px;
        background: rgba(71, 81, 96, 0.08);
        color: #475160;
        font-weight: 800;
        font-size: 13px;
    }

    /* ── דף הסליקה ─────────────────────────────────────────────────────────── */

    .frame-wrap {
        position: relative;
        width: 100%;
        max-width: 520px;
        min-height: 520px;
        border-radius: 20px;
        overflow: hidden;
        border: 1px solid rgba(198, 178, 154, 0.35);
        background: #f2f0ec;
    }

    .frame-wrap iframe {
        display: block;
        width: 100%;
        height: 520px;
        border: 0;
    }

    .frame-wrap.is-loading iframe {
        opacity: 0;
    }

    .frame-skeleton {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 26px 20px;
        justify-content: center;
    }

    /* ── שלדים ומצבים ──────────────────────────────────────────────────────── */

    .skeleton-wrap {
        width: 100%;
        max-width: 520px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        align-items: stretch;
        padding: 10px 0 6px;
    }

    .skeleton-line {
        height: 44px;
        border-radius: 14px;
        background: linear-gradient(
            90deg,
            rgba(71, 81, 96, 0.08) 25%,
            rgba(71, 81, 96, 0.16) 37%,
            rgba(71, 81, 96, 0.08) 63%
        );
        background-size: 400% 100%;
        animation: shimmer 1.4s ease infinite;
    }

    .skeleton-line.wide {
        height: 56px;
    }

    @keyframes shimmer {
        0% {
            background-position: 100% 50%;
        }
        100% {
            background-position: 0 50%;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .skeleton-line {
            animation: none;
        }
    }

    .skeleton-text {
        color: #475160;
        font-weight: 800;
        font-size: 14px;
        text-align: center;
        margin-top: 2px;
    }

    .error-box {
        width: 100%;
        max-width: 520px;
        padding: 14px 16px;
        border-radius: 20px;
        background: rgba(229, 57, 53, 0.08);
        border: 1px solid rgba(229, 57, 53, 0.35);
        color: #8c1d1a;
        font-weight: 800;
        font-size: 14px;
        line-height: 1.5;
        box-sizing: border-box;
    }

    .pay-btn {
        width: 100%;
        max-width: 520px;
        border: none;
        padding: 14px 18px;
        border-radius: 999px;
        cursor: pointer;
        font-weight: 900;
        font-size: 16px;
        transition: transform 0.2s ease, opacity 0.2s ease;
        background: #1e1e1e;
        color: #fff;
    }

    .pay-btn:hover {
        transform: translateY(-1px);
        opacity: 0.95;
    }

    .pay-btn.gold {
        background: #c6b29a;
        color: #1e1e1e;
    }

    .hint {
        margin: 0;
        max-width: 520px;
        color: #475160;
        font-weight: 700;
        font-size: 13px;
        line-height: 1.5;
    }

    @media (max-width: 520px) {
        .tranzila-payment {
            padding: 18px;
            border-radius: 24px;
        }

        .payment-amount .value {
            font-size: 34px;
        }

        .payment-meta {
            padding: 12px;
            border-radius: 18px;
        }

        .meta-row {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
        }

        .meta-row .k,
        .meta-row .v {
            max-width: 100%;
            text-align: right;
        }

        .frame-wrap,
        .frame-wrap iframe {
            min-height: 560px;
        }

        .frame-wrap iframe {
            height: 560px;
        }
    }
</style>
