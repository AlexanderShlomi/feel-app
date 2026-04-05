<script>
    import { createEventDispatcher } from 'svelte';

    export let orderId;
    /** מספר הזמנה ציבורי (order_number); UUID נשאר ב-orderId לפעולות פנימיות */
    export let orderNumber = /** @type {number | null} */ (null);
    export let amount = 0;

    const dispatch = createEventDispatcher();

    /** idle -> processing -> approved */
    let state = 'idle';

    function formatShekel(value) {
        const n = Number(value || 0);
        return n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    async function handlePay() {
        if (state !== 'idle') return;
        state = 'processing';

        // הדמיית תהליך תשלום (ללא טרנזילה כרגע)
        await new Promise((r) => setTimeout(r, 1800));

        state = 'approved';
        dispatch('approved', { orderId });
    }

    function resetToIdle() {
        state = 'idle';
    }
</script>

<div class="payment-mock">
    <div class="payment-inner">
        <div class="payment-header">
            <div class="payment-badge">תשלום מאובטח</div>
            <div class="payment-title">PaymentMock</div>
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

        {#if state === 'idle'}
            <button class="pay-btn gold" on:click={handlePay}>
                אישור תשלום בדמו
            </button>
            <p class="hint">בדמו: אין חיבור אמיתי לספק. לאחר אישור נעדכן את ההזמנה ל-`paid`.</p>
        {:else if state === 'processing'}
            <div class="loader-wrap" aria-live="polite">
                <div class="loader-bar"></div>
                <div class="loader-text">מעדכנים תשלום...</div>
            </div>
        {:else}
            <div class="approved-box">
                <div class="approved-check">✓</div>
                <div class="approved-text">אושר בהצלחה (דמו)</div>
            </div>
            <button class="text-btn" on:click={resetToIdle} type="button">
                איפוס דמו
            </button>
        {/if}
    </div>
</div>

<style>
    .payment-mock {
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
        color: #1E1E1E;
        font-weight: 800;
        font-size: 14px;
    }

    .payment-title {
        color: #1E1E1E;
        font-weight: 900;
        font-size: 20px;
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
        color: #6B7280;
        font-weight: 700;
        font-size: 14px;
    }

    .payment-amount .value {
        color: #C6B29A;
        font-weight: 950;
        font-size: 40px;
        line-height: 1;
    }

    .payment-meta {
        width: 100%;
        max-width: 520px;
        background: #F2F0EC;
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
        color: #1E1E1E;
        font-weight: 800;
        flex: 0 0 auto;
        min-width: 0;
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

    @media (max-width: 520px) {
        .payment-mock {
            padding: 18px;
            border-radius: 24px;
        }

        .payment-amount .value {
            font-size: 34px;
        }

        .payment-meta {
            padding: 12px 12px;
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
        }

        .meta-row .v {
            white-space: normal;
            overflow: visible;
            text-overflow: clip;
            word-break: break-word;
        }
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
        background: #1E1E1E;
        color: #fff;
    }

    .pay-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        opacity: 0.95;
    }

    .pay-btn.gold {
        background: #C6B29A;
        color: #1E1E1E;
    }

    .hint {
        margin: 0;
        max-width: 520px;
        color: #475160;
        font-weight: 700;
        font-size: 13px;
        line-height: 1.5;
    }

    .loader-wrap {
        width: 100%;
        max-width: 520px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        align-items: center;
        justify-content: center;
        padding: 10px 0 6px;
    }

    .loader-bar {
        width: 100%;
        height: 10px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(71, 81, 96, 0.12);
        border: 1px solid rgba(71, 81, 96, 0.18);
        position: relative;
    }

    .loader-bar::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        width: 45%;
        border-radius: 999px;
        background: linear-gradient(90deg, #3F524F, #475160);
        animation: tealNavySweep 1.1s infinite linear;
    }

    @keyframes tealNavySweep {
        0% { transform: translateX(-120%); }
        100% { transform: translateX(220%); }
    }

    .loader-text {
        color: #1E1E1E;
        font-weight: 900;
    }

    .approved-box {
        width: 100%;
        max-width: 520px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 14px 16px;
        background: rgba(198, 178, 154, 0.18);
        border: 1px solid rgba(198, 178, 154, 0.45);
        border-radius: 24px;
        box-sizing: border-box;
    }

    .approved-check {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: #C6B29A;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 950;
        color: #1E1E1E;
    }

    .approved-text {
        font-weight: 950;
        color: #1E1E1E;
    }

    .text-btn {
        border: none;
        background: none;
        cursor: pointer;
        color: #846349;
        font-weight: 900;
        text-decoration: underline;
        margin-top: 4px;
    }
</style>

