<script>
    import { onMount, tick } from 'svelte';
    import AuthModal from '$lib/components/AuthModal.svelte';
    import PaymentMock from '$lib/components/PaymentMock.svelte';
    import { supabase } from '$lib/supabase';
    import { cart, cartTotal } from '$lib/stores.js';
    import { goto } from '$app/navigation';
    import { user, profile, authLoading, refreshProfile } from '$lib/authStore';
    import { fetchCitySuggestions, fetchStreetSuggestions } from '$lib/addresses/govIlStreets.js';
    import { maskIsraelMobileInput, normalizeDigitsToIsraelMobile } from '$lib/validation/inputMasks.js';
    import {
        hasCheckoutPrivacyConsent,
        setCheckoutPrivacyConsent,
        clearCheckoutPrivacyConsent,
        requestOpenPrivacyPolicy,
        requestOpenCookiePolicy
    } from '$lib/privacyCheckoutConsent.js';
    import {
        currentPrivacyPolicy,
        recordPrivacyConsent,
        privacyNeedsReaccept
    } from '$lib/privacyPolicyStore.js';
    import { uploadOrderItemThumbnails } from '$lib/orderThumbnails.js';
    import { invalidateOrdersAfterCheckout } from '$lib/ordersCache.js';

    // ----- UI state -----
    let showAuthModal = false;
    let placeOrderLoading = false;
    let paymentOrderId = /** @type {string | null} */ (null);
    /** מספר הזמנה ציבורי (order_number) — לא UUID */
    let paymentOrderNumber = /** @type {number | null} */ (null);
    let paymentAmount = 0;
    let success = false;
    let errorMessage = '';

    // ----- Form state (right side) -----
    let couponCode = '';
    let giftEnabled = false;
    let giftMessage = '';
    let giftSenderName = '';
    let giftSenderPhone = '';

    let shippingFirstName = '';
    let shippingLastName = '';
    let shippingCity = '';
    let shippingStreet = '';
    let shippingHouseNumber = '';
    let shippingApartmentNumber = '';
    let shippingNotes = '';

    /** סמל ישוב (משרד הפנים) לאחר בחירה מהרשימה או התאמה */
    let shippingCitySymbol = /** @type {number | null} */ (null);
    let cityPickedName = '';
    let citySuggestions = /** @type {{ symbol: number; name: string }[]} */ ([]);
    let showCityList = false;
    let streetSuggestions = /** @type {{ name: string }[]} */ ([]);
    let showStreetList = false;
    let cityDebounce = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
    let streetDebounce = /** @type {ReturnType<typeof setTimeout> | null} */ (null);

    let didInitGiftFromProfile = false;
    /** מונע לולאה: סגירת AuthModal בלי התחברות — לא לכפות פתיחה מחדש בכל tick */
    let authPromptDismissed = false;

    /** אחרי התנתקות — לא לפתוח מודאל "התחבר" אוטומטית (המשתמש בחר להמשיך כאורח) */
    let hadUserWhileAuthReady = false;
    $: if (!$authLoading) {
        if (hadUserWhileAuthReady && !$user) {
            authPromptDismissed = true;
        }
        hadUserWhileAuthReady = !!$user;
    }

    /** אורח: localStorage. משתמש מחובר: גרסה ב-profiles מול privacy_policies */
    let privacyGateChecked = false;

    /**
     * אורח: localStorage מהסל.
     * מחובר: שער רק כשחסרה חתימה לגרסה העדכנית — אם כבר חתם, בלי אוברליי ולא מחייבים שוב.
     */
    $: needsPrivacyGate = $authLoading
        ? true
        : !$user
          ? !hasCheckoutPrivacyConsent() && !privacyGateChecked
          : privacyNeedsReaccept($profile, $currentPrivacyPolicy);

    async function onPrivacyGateCheckboxChange() {
        if (!privacyGateChecked) {
            if (!$user) clearCheckoutPrivacyConsent();
            return;
        }
        if (!$user) {
            setCheckoutPrivacyConsent();
            return;
        }
        if (!privacyNeedsReaccept($profile, $currentPrivacyPolicy)) return;
        const err = await recordPrivacyConsent();
        if (err) {
            privacyGateChecked = false;
            errorMessage = supabaseErrorMessage(err);
            return;
        }
        if ($user?.id) await refreshProfile($user.id);
    }

    $: if (!$authLoading && !$user && !authPromptDismissed) showAuthModal = true;

    $: if ($user) showAuthModal = false;

    $: if (giftEnabled && $profile && !didInitGiftFromProfile) {
        giftSenderName = $profile.full_name || '';
        giftSenderPhone = normalizeDigitsToIsraelMobile($profile.phone || '');
        didInitGiftFromProfile = true;
    }

    function closeAuthModal() {
        showAuthModal = false;
        authPromptDismissed = true;
    }

    function supabaseErrorMessage(e) {
        if (!e) return 'שגיאה לא ידועה';
        if (typeof e.message === 'string' && e.message) return e.message;
        if (typeof e.details === 'string' && e.details) return e.details;
        if (typeof e.hint === 'string' && e.hint) return e.hint;
        if (typeof e.code === 'string' && e.code) return `שגיאה (${e.code})`;
        try {
            return JSON.stringify(e);
        } catch {
            return String(e);
        }
    }

    /**
     * jsonb ל-order_items — בלי base64/בלובים (תמונות בסל יכולות להגיע למגהבייטים
     * ולגרום ל-timeout או לחסימה ב-Supabase). שומרים מטא להזמנה ולתפעול.
     */
    function buildOrderItemConfiguration(item) {
        try {
            const out = {
                id: item?.id,
                type: item?.type,
                title: item?.title,
                subtitle: item?.subtitle ?? null,
                price: item?.price,
                count: item?.count,
                timestamp: item?.timestamp
            };
            const data = item?.data;
            if (data && typeof data === 'object') {
                const settings = data.settings;
                if (settings && typeof settings === 'object') {
                    out.settingsMeta = {
                        currentProductType: settings.currentProductType,
                        gridBaseSize: settings.gridBaseSize,
                        currentDisplayScale: settings.currentDisplayScale,
                        currentEffect: settings.currentEffect,
                        isSurfaceDark: settings.isSurfaceDark
                    };
                }
                if (Array.isArray(data.magnets)) {
                    out.magnetsMeta = data.magnets.map((m) => ({
                        id: m?.id,
                        hidden: !!m?.hidden,
                        size: m?.size,
                        activeEffectId: m?.activeEffectId,
                        x: m?.x,
                        y: m?.y,
                        rotation: m?.rotation
                    }));
                }
            }
            const prev = item?.previewImage;
            if (typeof prev === 'string' && prev.length > 240) {
                out.previewImageNote = prev.startsWith('data:') ? 'embedded_data_url_omitted' : 'long_url_omitted';
            } else if (prev != null) {
                out.previewImage = prev;
            }
            return out;
        } catch (err) {
            console.warn('Order item configuration fallback:', err);
            return {
                id: item?.id,
                type: item?.type,
                title: item?.title,
                price: item?.price,
                note: 'configuration_fallback'
            };
        }
    }

    function parseIntOrNull(value) {
        const n = parseInt(String(value || '').trim(), 10);
        return Number.isFinite(n) ? n : null;
    }

    function validateShipping() {
        if (!shippingFirstName.trim()) return 'שם פרטי הוא שדה חובה';
        if (!shippingLastName.trim()) return 'שם משפחה הוא שדה חובה';
        if (!shippingCity.trim()) return 'עיר היא שדה חובה';
        if (!shippingStreet.trim()) return 'רחוב הוא שדה חובה';

        const houseNumber = parseIntOrNull(shippingHouseNumber);
        if (houseNumber === null) return 'מספר בית הוא שדה חובה';

        const aptNumber = parseIntOrNull(shippingApartmentNumber);
        if (shippingApartmentNumber && aptNumber === null) return 'מספר דירה חייב להיות מספר';

        /* טלפון מתנה: רק ספרות/מקף (מסכה) — לא חוסמים שליחה בגלל פורמט נייד קשיח */
        if (giftEnabled && giftSenderPhone.trim()) {
            const digits = giftSenderPhone.replace(/\D/g, '');
            if (digits.length > 0 && digits.length < 9) {
                return 'יש להשלים את מספר הטלפון (לפחות 9 ספרות)';
            }
        }

        return null;
    }

    function onGiftPhoneInput(/** @type {Event & { currentTarget: HTMLInputElement }} */ e) {
        giftSenderPhone = maskIsraelMobileInput(e.currentTarget.value);
    }

    function pickCity(/** @type {{ symbol: number; name: string }} */ c) {
        shippingCity = c.name;
        cityPickedName = c.name;
        shippingCitySymbol = c.symbol;
        shippingStreet = '';
        citySuggestions = [];
        showCityList = false;
    }

    function onCityInput() {
        if (cityPickedName && shippingCity.trim() !== cityPickedName.trim()) {
            shippingCitySymbol = null;
            cityPickedName = '';
        }
        if (cityDebounce) clearTimeout(cityDebounce);
        const t = shippingCity.trim();
        if (t.length < 2) {
            citySuggestions = [];
            showCityList = false;
            return;
        }
        cityDebounce = setTimeout(async () => {
            try {
                citySuggestions = await fetchCitySuggestions(t);
                showCityList = citySuggestions.length > 0;
            } catch {
                citySuggestions = [];
            }
        }, 320);
    }

    function onCityBlur() {
        setTimeout(() => {
            showCityList = false;
        }, 180);
        setTimeout(async () => {
            if (shippingCitySymbol != null || !shippingCity.trim()) return;
            try {
                const list = await fetchCitySuggestions(shippingCity.trim());
                const exact = list.find((x) => x.name.trim() === shippingCity.trim());
                if (exact) {
                    shippingCitySymbol = exact.symbol;
                    cityPickedName = exact.name;
                }
            } catch {
                /* ignore */
            }
        }, 220);
    }

    function onStreetInput() {
        if (streetDebounce) clearTimeout(streetDebounce);
        if (shippingCitySymbol == null) {
            streetSuggestions = [];
            showStreetList = false;
            return;
        }
        const t = shippingStreet.trim();
        if (t.length < 1) {
            streetSuggestions = [];
            showStreetList = false;
            return;
        }
        streetDebounce = setTimeout(async () => {
            try {
                streetSuggestions = await fetchStreetSuggestions(shippingCitySymbol, t);
                showStreetList = streetSuggestions.length > 0;
            } catch {
                streetSuggestions = [];
            }
        }, 320);
    }

    function pickStreet(/** @type {{ name: string }} */ s) {
        shippingStreet = s.name;
        streetSuggestions = [];
        showStreetList = false;
    }

    function onStreetBlur() {
        setTimeout(() => {
            showStreetList = false;
        }, 180);
    }

    async function scrollToCheckoutError() {
        await tick();
        document.getElementById('checkout-form-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function scrollToCheckoutPayment() {
        await tick();
        document.getElementById('checkout-payment-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    /**
     * אחרי שההזמנה נשמרה — מעלה thumbnails ומעדכן שורות (לא חוסם את מסך התשלום).
     * @param {string} userId
     * @param {string} orderId
     * @param {unknown[]} cartSnapshot
     * @param {string[]} itemRowIds
     */
    function backfillOrderThumbnailsInBackground(userId, orderId, cartSnapshot, itemRowIds) {
        if (!userId || !orderId || !itemRowIds?.length || !cartSnapshot?.length) return;
        void (async () => {
            try {
                const thumbnailUrls = await uploadOrderItemThumbnails(
                    supabase,
                    userId,
                    orderId,
                    /** @type {Array<{ previewImage?: string | null }>} */ (cartSnapshot)
                );
                for (let i = 0; i < itemRowIds.length && i < thumbnailUrls.length; i++) {
                    const url = thumbnailUrls[i];
                    if (!url) continue;
                    const { error: patchErr } = await supabase.rpc('patch_order_item_thumbnail', {
                        p_item_id: itemRowIds[i],
                        p_thumbnail_url: url
                    });
                    if (patchErr) console.warn('patch_order_item_thumbnail', i, patchErr);
                }
            } catch (e) {
                console.warn('Order thumbnails backfill:', e);
            }
        })();
    }

    async function handlePlaceOrder() {
        errorMessage = '';
        success = false;
        showCityList = false;
        showStreetList = false;

        if ($user) {
            if (privacyNeedsReaccept($profile, $currentPrivacyPolicy)) {
                errorMessage =
                    'יש לאשר את מדיניות הפרטיות העדכנית (הגרסה בשרת) לפני יצירת הזמנה.';
                await scrollToCheckoutError();
                return;
            }
        } else if (!hasCheckoutPrivacyConsent()) {
            errorMessage = 'יש לאשר את מדיניות הפרטיות לפני יצירת הזמנה.';
            await scrollToCheckoutError();
            return;
        }

        if (!($cart && $cart.length > 0)) {
            errorMessage = 'הסל ריק. הוסיפו פריטים מהיצירה ואז חזרו לכאן.';
            await scrollToCheckoutError();
            return;
        }
        if (!$user?.id) {
            authPromptDismissed = false;
            showAuthModal = true;
            errorMessage = 'יש להתחבר כדי להשלים את ההזמנה.';
            await scrollToCheckoutError();
            return;
        }

        const shippingError = validateShipping();
        if (shippingError) {
            errorMessage = shippingError;
            await scrollToCheckoutError();
            return;
        }

        placeOrderLoading = true;
        try {
            const subtotalAmount = Number($cartTotal || 0);
            const totalAmount = subtotalAmount; // כרגע בלי הנחות/משלוח

            const houseNumber = parseIntOrNull(shippingHouseNumber);
            const apartmentNumber = parseIntOrNull(shippingApartmentNumber);

            const newOrderId =
                typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

            const cartSnapshot = [...($cart || [])];

            const shippingPayload = {
                firstName: shippingFirstName.trim(),
                lastName: shippingLastName.trim(),
                city: shippingCity.trim(),
                street: shippingStreet.trim(),
                houseNum: String(houseNumber ?? '').trim(),
                aptNum: apartmentNumber == null ? '' : String(apartmentNumber),
                notes: shippingNotes.trim() ? shippingNotes.trim() : '',
                couponCode: couponCode.trim() ? couponCode.trim() : ''
            };

            const giftPayload = {
                enabled: giftEnabled,
                message: giftEnabled && giftMessage.trim() ? giftMessage.trim() : '',
                senderName: giftEnabled && giftSenderName.trim() ? giftSenderName.trim() : '',
                senderPhone: giftEnabled && giftSenderPhone.trim() ? giftSenderPhone.trim() : ''
            };

            const itemsPayload = cartSnapshot.map((item) => {
                const raw = Number(item.price);
                const price = Number.isFinite(raw) && raw >= 0 ? raw : 0;
                return {
                    type: item.type ?? null,
                    title: item.title ?? '',
                    subtitle: item.subtitle ?? null,
                    price,
                    quantity: 1,
                    thumbnail_url: null,
                    configuration: buildOrderItemConfiguration(item)
                };
            });

            const { data: rpcData, error: rpcError } = await supabase.rpc('create_complete_order', {
                p_order_id: newOrderId,
                p_shipping_data: shippingPayload,
                p_gift_data: giftPayload,
                p_items: itemsPayload,
                p_subtotal: subtotalAmount,
                p_total: totalAmount
            });
            if (rpcError) throw rpcError;

            let resolvedOrderId = newOrderId;
            let itemRowIds = /** @type {string[]} */ ([]);
            if (rpcData != null && typeof rpcData === 'object' && !Array.isArray(rpcData)) {
                const o = /** @type {{ order_id?: string; item_ids?: unknown }} */ (rpcData);
                if (o.order_id) resolvedOrderId = String(o.order_id);
                if (Array.isArray(o.item_ids)) {
                    itemRowIds = o.item_ids.map((id) => String(id));
                }
            } else if (typeof rpcData === 'string' && rpcData) {
                resolvedOrderId = rpcData;
            }

            // רק אחרי ששני ה-insert הצליחו: מציגים את מסך התשלום
            paymentOrderId = resolvedOrderId;
            paymentAmount = totalAmount;
            paymentOrderNumber = null;
            if (paymentOrderId) {
                const { data: ordRow, error: numErr } = await supabase
                    .from('orders')
                    .select('order_number')
                    .eq('id', paymentOrderId)
                    .single();
                if (!numErr && ordRow?.order_number != null) {
                    paymentOrderNumber = Number(ordRow.order_number);
                }
            }
            await scrollToCheckoutPayment();

            if ($user?.id && itemRowIds.length > 0) {
                backfillOrderThumbnailsInBackground($user.id, paymentOrderId, cartSnapshot, itemRowIds);
            }
        } catch (e) {
            console.error('Place order failed:', e);
            errorMessage = supabaseErrorMessage(e);
            paymentOrderId = null;
            paymentOrderNumber = null;
            await scrollToCheckoutError();
        } finally {
            placeOrderLoading = false;
        }
    }

    async function handlePaymentApproved() {
        errorMessage = '';
        if (!$user?.id || !paymentOrderId) return;
        if (privacyNeedsReaccept($profile, $currentPrivacyPolicy)) {
            errorMessage = 'יש לאשר את מדיניות הפרטיות העדכנית לפני השלמת התשלום.';
            return;
        }

        placeOrderLoading = true;
        try {
            const { error } = await supabase.rpc('confirm_order_payment', {
                p_order_id: paymentOrderId
            });
            if (error) throw error;

            // Ensure /orders doesn't serve stale session cache after a successful payment confirmation.
            invalidateOrdersAfterCheckout({
                userId: $user.id,
                orderId: paymentOrderId,
                expectedStatus: 'paid'
            });

            // ריקון עגלה
            cart.set([]);
            success = true;

            // Navigate only after final payment confirmation RPC.
            await goto(`/checkout/success/${paymentOrderId}`);
        } catch (e) {
            console.error('Update order to paid failed:', e);
            errorMessage = supabaseErrorMessage(e);
        } finally {
            placeOrderLoading = false;
        }
    }

    onMount(() => {
        // כדי למנוע מצבים של hydration/SSR לא אחיד: כשהמשתמש מחובר, לא מציגים AuthModal.
        if ($user?.id) showAuthModal = false;
    });
</script>

<div class="checkout-page" dir="rtl">
    {#if needsPrivacyGate}
        <div
            class="privacy-checkout-gate"
            role="dialog"
            aria-modal="true"
            aria-labelledby="privacy-gate-title"
        >
            <div class="privacy-checkout-gate-card">
                <h2 id="privacy-gate-title" class="privacy-gate-heading">לפני התשלום</h2>
                <p class="privacy-gate-lead">
                    כדי להמשיך, יש לאשר שקראת והסכמת ל־
                    <button type="button" class="privacy-gate-link" on:click={requestOpenPrivacyPolicy}>
                        מדיניות הפרטיות
                    </button>
                    {#if $user && $currentPrivacyPolicy?.version}
                        <span class="privacy-version-hint"> (גרסה {$currentPrivacyPolicy.version})</span>
                    {/if}
                    .
                </p>
                <p class="privacy-gate-cookies">
                    מידע על אחסון מקומי ועוגיות:
                    <button type="button" class="privacy-gate-link" on:click={requestOpenCookiePolicy}>
                        מדיניות קובצי Cookie
                    </button>
                </p>
                <label class="privacy-gate-label">
                    <input
                        type="checkbox"
                        bind:checked={privacyGateChecked}
                        on:change={onPrivacyGateCheckboxChange}
                    />
                    <span>קראתי והסכמתי למדיניות הפרטיות</span>
                </label>
            </div>
        </div>
    {/if}

    <div class="checkout-container" class:checkout-gated={needsPrivacyGate}>
    <div class="checkout-grid">
        <!-- Left column (~30%): סיכום + כפתור ראשי (דביק בדסקטופ) -->
        <aside class="checkout-left">
            <section class="summary-card" aria-label="סיכום הזמנה">
                <h2 class="summary-title">סיכום הזמנה</h2>

                <div class="summary-items theme-scroll">
                    {#if $cart.length === 0}
                        <div class="empty-cart">
                            הסל ריק. חזרו ליצירה.
                        </div>
                    {:else}
                        {#each $cart as item (item.id)}
                            <div class="summary-item" role="listitem">
                                <div class="item-img">
                                    {#if item.previewImage}
                                        <img src={item.previewImage} alt={item.title} loading="eager" decoding="async" />
                                    {:else}
                                        <div class="no-img">—</div>
                                    {/if}
                                </div>
                                <div class="item-body">
                                    <div class="item-top">
                                        <div class="item-title">{item.title}</div>
                                        <div class="item-price">₪{Number(item.price || 0).toLocaleString('he-IL')}</div>
                                    </div>
                                    {#if item.subtitle}
                                        <div class="item-subtitle">{item.subtitle}</div>
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    {/if}
                </div>

                <div class="summary-line">
                    <span class="muted">משלוח עד הבית</span>
                    <span class="muted">חינם</span>
                </div>
                <div class="summary-total">
                    <span class="total-label">סה"כ לתשלום</span>
                    <span class="total-value">₪{Number($cartTotal || 0).toLocaleString('he-IL')}</span>
                </div>
            </section>

            {#if !success && !paymentOrderId}
                <div class="checkout-cta-bar">
                    <button
                        class="place-order-btn"
                        type="button"
                        disabled={placeOrderLoading || $cart.length === 0 || needsPrivacyGate}
                        on:click|stopPropagation={handlePlaceOrder}
                    >
                        {#if placeOrderLoading}
                            יצירת הזמנה...
                        {:else}
                            מעבר לתשלום מאובטח
                        {/if}
                    </button>
                </div>
            {/if}
        </aside>

        <!-- Right column (~70%): טופס משלוח -->
        <section class="forms-card" aria-label="פרטי משלוח ותשלום">
            <div class="forms-inner">
                {#if showAuthModal}
                    <AuthModal isOpen={showAuthModal} close={closeAuthModal} />
                {/if}

                <h2 class="forms-title">לתשלום מאובטח</h2>

                {#if success}
                    <div class="success-box">
                        <div class="success-check">✓</div>
                        <div class="success-text">
                            נחת
                            <div class="success-sub">ההזמנה התקבלה בהצלחה.</div>
                            {#if paymentOrderNumber != null}
                                <div class="success-order-num">מספר הזמנה #{paymentOrderNumber}</div>
                            {/if}
                        </div>
                    </div>
                {:else if paymentOrderId}
                    <div id="checkout-payment-panel" class="checkout-payment-panel">
                    <PaymentMock
                        orderId={paymentOrderId}
                        orderNumber={paymentOrderNumber}
                        amount={paymentAmount}
                        on:approved={handlePaymentApproved}
                    />

                    {#if placeOrderLoading}
                        <div class="inline-loading" aria-live="polite">
                            מעדכנים הזמנה...
                            <div class="inline-loader"></div>
                        </div>
                    {/if}
                    </div>
                {:else}
                    <div class="form-grid">
                        <div class="input-group">
                            <label class="label" for="coupon">קוד קופון</label>
                            <input
                                id="coupon"
                                class="input"
                                type="text"
                                placeholder="לא פעיל לוגית בדמו"
                                bind:value={couponCode}
                            />
                        </div>

                        <div class="gift-toggle">
                            <div class="gift-toggle-left">
                                <div class="label">רכיב מתנה</div>
                                <div class="gift-toggle-desc">אם פעיל: נפתח שדות לברכה, שם שולח וטלפון.</div>
                            </div>

                            <label class="switch">
                                <input type="checkbox" bind:checked={giftEnabled} />
                                <span class="slider"></span>
                            </label>
                        </div>

                        {#if giftEnabled}
                            <div class="gift-fields">
                                <div class="input-group">
                                    <label class="label" for="giftMessage">ברכה</label>
                                    <textarea
                                        id="giftMessage"
                                        class="input textarea"
                                        placeholder="כתבו ברכה קצרה..."
                                        bind:value={giftMessage}
                                    ></textarea>
                                </div>

                                <div class="input-group">
                                    <label class="label" for="giftSenderName">שם שולח</label>
                                    <input
                                        id="giftSenderName"
                                        class="input"
                                        type="text"
                                        placeholder="שם השולח"
                                        bind:value={giftSenderName}
                                    />
                                </div>

                                <div class="input-group">
                                    <label class="label" for="giftSenderPhone">טלפון</label>
                                    <input
                                        id="giftSenderPhone"
                                        class="input"
                                        type="tel"
                                        inputmode="numeric"
                                        autocomplete="tel"
                                        placeholder="05X-XXX-XXXX"
                                        value={giftSenderPhone}
                                        on:input={onGiftPhoneInput}
                                    />
                                </div>
                            </div>
                        {/if}

                        <div class="separator"></div>

                        <div class="name-row">
                            <div class="input-group">
                                <label class="label" for="firstName">שם פרטי (חובה)</label>
                                <input
                                    id="firstName"
                                    class="input"
                                    type="text"
                                    placeholder="לדוגמה: יעל"
                                    bind:value={shippingFirstName}
                                    required
                                />
                            </div>
                            <div class="input-group">
                                <label class="label" for="lastName">שם משפחה (חובה)</label>
                                <input
                                    id="lastName"
                                    class="input"
                                    type="text"
                                    placeholder="לדוגמה: כהן"
                                    bind:value={shippingLastName}
                                    required
                                />
                            </div>
                        </div>

                        <div class="city-street-row">
                            <div class="input-group autocomplete-group">
                                <label class="label" for="city">עיר (חובה)</label>
                                <div class="autocomplete-wrap">
                                    <input
                                        id="city"
                                        class="input"
                                        type="text"
                                        placeholder="שם ישוב — חיפוש לפי data.gov.il"
                                        bind:value={shippingCity}
                                        on:input={onCityInput}
                                        on:focus={() => {
                                            if (citySuggestions.length) showCityList = true;
                                        }}
                                        on:blur={onCityBlur}
                                        autocomplete="off"
                                        required
                                    />
                                    {#if showCityList && citySuggestions.length}
                                        <ul class="suggest-list theme-scroll" role="listbox">
                                            {#each citySuggestions as c (c.symbol + c.name)}
                                                <li
                                                    role="option"
                                                    aria-selected="false"
                                                    class="suggest-item"
                                                    on:mousedown|preventDefault={() => pickCity(c)}
                                                >
                                                    {c.name}
                                                </li>
                                            {/each}
                                        </ul>
                                    {/if}
                                </div>
                            </div>
                            <div class="input-group autocomplete-group">
                                <label class="label" for="street">רחוב (חובה)</label>
                                <div class="autocomplete-wrap">
                                    <input
                                        id="street"
                                        class="input"
                                        type="text"
                                        placeholder={shippingCitySymbol == null
                                            ? 'בחרו עיר — ואז חיפוש רחוב'
                                            : 'שם רחוב — רשימה רשמית'}
                                        bind:value={shippingStreet}
                                        on:input={onStreetInput}
                                        on:focus={() => {
                                            if (streetSuggestions.length && shippingCitySymbol != null)
                                                showStreetList = true;
                                        }}
                                        on:blur={onStreetBlur}
                                        autocomplete="off"
                                        required
                                    />
                                    {#if showStreetList && streetSuggestions.length && shippingCitySymbol != null}
                                        <ul class="suggest-list theme-scroll" role="listbox">
                                            {#each streetSuggestions as s (s.name)}
                                                <li
                                                    role="option"
                                                    aria-selected="false"
                                                    class="suggest-item"
                                                    on:mousedown|preventDefault={() => pickStreet(s)}
                                                >
                                                    {s.name}
                                                </li>
                                            {/each}
                                        </ul>
                                    {/if}
                                </div>
                            </div>
                        </div>

                        <div class="house-apt-row">
                            <div class="input-group">
                                <label class="label" for="houseNumber">מספר בית (חובה)</label>
                                <input
                                    id="houseNumber"
                                    class="input"
                                    type="number"
                                    inputmode="numeric"
                                    min="1"
                                    placeholder="לדוגמה: 12"
                                    bind:value={shippingHouseNumber}
                                    required
                                />
                            </div>
                            <div class="input-group">
                                <label class="label" for="apartmentNumber">מספר דירה</label>
                                <input
                                    id="apartmentNumber"
                                    class="input"
                                    type="number"
                                    inputmode="numeric"
                                    min="1"
                                    placeholder="לדוגמה: 4"
                                    bind:value={shippingApartmentNumber}
                                />
                            </div>
                        </div>

                        <div class="input-group">
                            <label class="label" for="notes">הערות לכתובת</label>
                            <textarea
                                id="notes"
                                class="input textarea"
                                placeholder="לדוגמה: קומה, קוד כניסה..."
                                bind:value={shippingNotes}
                            ></textarea>
                        </div>

                        <div class="shipping-method">
                            <div class="ship-icon">🚚</div>
                            <div class="ship-text">
                                <div class="ship-title">משלוח עד הבית - חינם</div>
                                <div class="ship-subtitle">תשלום מאובטח באמצעות ספק טרנזילה (דמו כרגע)</div>
                            </div>
                        </div>

                        {#if errorMessage}
                            <div id="checkout-form-error" class="error-box" role="alert">{errorMessage}</div>
                        {/if}
                    </div>
                {/if}
            </div>
        </section>
    </div>
    </div>
</div>

<style>
    /* ללא page-container כפול — ה-layout כבר מוסיף padding-top לכותרת; מונע גלילה מיותרת */
    .checkout-page {
        position: relative;
        width: 100%;
        box-sizing: border-box;
        background: var(--color-canvas-bg);
        padding: 20px clamp(16px, 3vw, 28px) 28px;
    }

    .privacy-checkout-gate {
        position: fixed;
        inset: 0;
        z-index: 8000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        box-sizing: border-box;
        background: rgba(30, 26, 22, 0.78);
        backdrop-filter: blur(8px);
    }

    .privacy-checkout-gate-card {
        width: 100%;
        max-width: 420px;
        background: #faf8f5;
        border-radius: 18px;
        padding: 28px 24px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.28);
        border: 1px solid rgba(198, 178, 154, 0.45);
        text-align: right;
        direction: rtl;
    }

    .privacy-gate-heading {
        margin: 0 0 12px;
        font-size: 1.35rem;
        font-weight: 800;
        color: #1e1e1e;
    }

    .privacy-gate-lead {
        margin: 0 0 18px;
        font-size: 0.95rem;
        line-height: 1.55;
        color: #3a3530;
    }

    .privacy-gate-cookies {
        margin: 0 0 18px;
        font-size: 0.88rem;
        line-height: 1.5;
        color: #5c574f;
    }

    .privacy-gate-link {
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        font: inherit;
        font-weight: 800;
        color: #846349;
        text-decoration: underline;
        cursor: pointer;
    }

    .privacy-gate-link:hover {
        color: #1e1e1e;
    }

    .privacy-version-hint {
        font-weight: 600;
        color: var(--color-medium-blue-gray, #475160);
    }

    .privacy-gate-label {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        cursor: pointer;
        font-size: 0.95rem;
        font-weight: 700;
        color: #1e1e1e;
        line-height: 1.45;
    }

    .privacy-gate-label input {
        margin-top: 3px;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        accent-color: var(--color-teal, #3f524f);
    }

    .checkout-container.checkout-gated {
        /* Visual dim only. Interaction is blocked by the full-screen privacy gate overlay. */
        user-select: none;
        opacity: 0.45;
        filter: grayscale(0.15);
    }

    .checkout-container {
        width: 100%;
        max-width: 1100px;
        margin: 0 auto;
        box-sizing: border-box;
        background: color-mix(in srgb, var(--color-canvas-bg) 92%, var(--color-gold));
        border: 1px solid color-mix(in srgb, var(--color-gold) 35%, transparent);
        border-radius: 20px;
        padding: 20px 22px;
        box-shadow: 0 2px 20px rgba(30, 30, 30, 0.06);
    }

    .checkout-grid {
        direction: ltr; /* עמודה 1: סיכום | עמודה 2: טופס (ימין בעברית) */
        display: grid;
        grid-template-columns: minmax(0, 3fr) minmax(0, 7fr);
        gap: 22px;
        align-items: start;
    }

    .checkout-left {
        direction: rtl;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: 0;
    }

    @media (min-width: 901px) {
        .checkout-left {
            position: sticky;
            top: calc(70px + 16px);
            align-self: start;
            max-height: calc(100vh - 70px - 32px);
        }
    }

    .summary-card {
        direction: rtl;
        background: var(--color-dark-blue);
        color: var(--color-canvas-bg);
        border-radius: 18px;
        padding: 18px 18px 16px;
        box-sizing: border-box;
        border: 1px solid color-mix(in srgb, var(--color-gold) 22%, transparent);
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    @media (min-width: 901px) {
        .summary-card {
            flex: 1 1 auto;
            min-height: 0;
            max-height: 100%;
        }
    }

    .summary-title {
        margin: 0 0 10px 0;
        font-weight: 950;
        font-size: 18px;
        letter-spacing: 0.2px;
        color: var(--color-canvas-bg);
    }

    .summary-items {
        display: flex;
        flex-direction: column;
        gap: 8px;
        overflow-y: auto;
        padding-left: 2px;
        min-height: 0;
        flex: 1 1 auto;
        max-height: 36vh;
    }

    @media (min-width: 901px) {
        .summary-items {
            max-height: min(36vh, 280px);
        }
    }

    .summary-item {
        display: flex;
        gap: 12px;
        align-items: center;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.04);
        padding: 10px;
        border: 1px solid rgba(198, 178, 154, 0.14);
        box-sizing: border-box;
    }

    .item-img {
        width: 56px;
        height: 56px;
        border-radius: 14px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.05);
        flex-shrink: 0;
        border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .item-img img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .no-img {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.6;
        font-weight: 900;
    }

    .item-body { flex: 1; display: flex; flex-direction: column; gap: 4px; }
    .item-top { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }

    .item-title {
        font-weight: 900;
        font-size: 14px;
        line-height: 1.25;
    }

    .item-price {
        font-weight: 950;
        color: var(--color-gold);
        font-size: 14px;
        white-space: nowrap;
    }

    .item-subtitle {
        opacity: 0.85;
        font-weight: 700;
        font-size: 12px;
        line-height: 1.35;
    }

    .empty-cart {
        padding: 18px 10px;
        background: rgba(255, 255, 255, 0.04);
        border-radius: 18px;
        border: 1px dashed rgba(198, 178, 154, 0.25);
        font-weight: 800;
        opacity: 0.95;
    }

    .summary-line {
        margin-top: 16px;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-weight: 900;
        color: rgba(242, 240, 236, 0.88);
    }

    .muted { opacity: 0.9; }

    .summary-total {
        margin-top: 8px;
        padding-top: 12px;
        border-top: 1px solid color-mix(in srgb, var(--color-gold) 28%, transparent);
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
        flex-shrink: 0;
    }

    .total-label {
        font-weight: 900;
        opacity: 0.9;
    }

    .total-value {
        color: var(--color-gold);
        font-size: 22px;
        font-weight: 1000;
    }

    .forms-card {
        direction: rtl;
        background: var(--color-light-gray);
        border-radius: 18px;
        padding: 20px 20px 18px;
        border: 1px solid color-mix(in srgb, var(--color-gold) 28%, #e8e4df);
        box-sizing: border-box;
        box-shadow: 0 4px 22px rgba(30, 30, 30, 0.07);
    }

    .forms-inner {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .checkout-payment-panel {
        scroll-margin-top: 88px;
    }

    .forms-title {
        margin: 0;
        font-weight: 1000;
        color: var(--color-dark-blue);
        font-size: 20px;
    }

    .form-grid {
        display: flex;
        flex-direction: column;
        gap: 11px;
    }

    .input-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .autocomplete-group .autocomplete-wrap {
        position: relative;
    }

    .suggest-list {
        position: absolute;
        z-index: 50;
        left: 0;
        right: 0;
        top: calc(100% + 4px);
        margin: 0;
        padding: 6px 0;
        list-style: none;
        max-height: min(240px, 40vh);
        overflow-y: auto;
        border-radius: 14px;
        background: var(--color-light-gray);
        border: 1px solid color-mix(in srgb, var(--color-gold) 35%, #e0dcd6);
        box-shadow: 0 10px 28px rgba(30, 30, 30, 0.12);
    }

    .suggest-item {
        padding: 10px 14px;
        font-weight: 800;
        font-size: 14px;
        color: var(--color-dark-blue);
        cursor: pointer;
        transition: background 0.12s ease;
    }

    .suggest-item:hover,
    .suggest-item:focus {
        background: color-mix(in srgb, var(--color-canvas-bg) 55%, var(--color-gold));
    }

    .label {
        font-weight: 900;
        color: var(--color-dark-blue);
        font-size: 12px;
    }

    .input {
        width: 100%;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--color-gold) 45%, #e0dcd6);
        background: var(--color-light-gray);
        padding: 0 20px 0 12px;
        font-size: 14px;
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
        font-weight: 800;
        color: var(--color-dark-blue);
    }

    .input:not(.textarea) {
        height: 40px;
        min-height: 40px;
    }

    .input:focus {
        border-color: var(--color-gold);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-gold) 22%, transparent);
    }

    .textarea {
        min-height: 72px;
        resize: vertical;
        padding: 10px 20px 10px 12px;
        height: auto;
    }

    .name-row {
        display: flex;
        flex-direction: column;
        gap: 11px;
    }

    @media (min-width: 901px) {
        .name-row {
            flex-direction: row;
            flex-wrap: nowrap;
            gap: 12px;
            align-items: flex-end;
        }

        .name-row .input-group {
            flex: 1 1 0;
            min-width: 0;
        }
    }

    .city-street-row,
    .house-apt-row {
        display: flex;
        flex-direction: column;
        gap: 11px;
    }

    @media (min-width: 901px) {
        .city-street-row,
        .house-apt-row {
            flex-direction: row;
            flex-wrap: nowrap;
            align-items: flex-end;
            gap: 12px;
        }

        .city-street-row .input-group,
        .house-apt-row .input-group {
            flex: 1 1 0;
            min-width: 0;
        }
    }

    .separator {
        height: 1px;
        background: rgba(198, 178, 154, 0.35);
        margin: 6px 0;
    }

    .gift-toggle {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: center;
        background: rgba(198, 178, 154, 0.1);
        border: 1px solid #e5e5e5;
        padding: 16px 16px;
        border-radius: 20px;
    }

    .gift-toggle-left { display: flex; flex-direction: column; gap: 6px; }
    .gift-toggle-desc { color: var(--color-dark-gray); font-weight: 800; font-size: 12px; line-height: 1.45; }

    /* Switch */
    .switch {
        position: relative;
        display: inline-block;
        width: 54px;
        height: 30px;
    }

    .switch input {
        opacity: 0;
        width: 0;
        height: 0;
    }

    .slider {
        position: absolute;
        cursor: pointer;
        inset: 0;
        background: rgba(30, 30, 30, 0.18);
        border-radius: 999px;
        transition: 0.2s ease;
        border: 1px solid rgba(0, 0, 0, 0.08);
    }

    .slider:before {
        position: absolute;
        content: '';
        height: 22px;
        width: 22px;
        left: 4px;
        top: 3px;
        background: #fff;
        border-radius: 50%;
        transition: 0.2s ease;
        box-shadow: 0 6px 14px rgba(0, 0, 0, 0.12);
    }

    .switch input:checked + .slider {
        background: rgba(63, 82, 79, 0.35);
        border-color: rgba(198, 178, 154, 0.55);
    }

    .switch input:checked + .slider:before {
        transform: translateX(24px);
        background: #C6B29A;
    }

    .gift-fields {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 10px 0 0;
    }

    .shipping-method {
        display: flex;
        gap: 12px;
        align-items: center;
        padding: 12px 14px;
        border-radius: 16px;
        border: 1px solid color-mix(in srgb, var(--color-gold) 30%, #e5e1db);
        background: color-mix(in srgb, var(--color-canvas-bg) 65%, #fff);
    }

    .ship-icon { font-size: 20px; }
    .ship-title { font-weight: 1000; color: var(--color-dark-blue); font-size: 13px; }
    .ship-subtitle { font-weight: 800; color: var(--color-dark-gray); font-size: 11px; margin-top: 2px; line-height: 1.4; }

    .checkout-cta-bar {
        margin-top: 0;
        position: relative;
        z-index: 10;
    }

    .place-order-btn {
        width: 100%;
        border: 2px solid var(--color-gold);
        border-radius: 16px;
        padding: 12px 18px;
        cursor: pointer;
        font-weight: 1000;
        font-size: 15px;
        background: var(--color-canvas-bg);
        color: var(--color-dark-blue);
        box-shadow: 0 2px 12px rgba(30, 30, 30, 0.08);
        transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease, opacity 0.2s ease;
    }

    .place-order-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        background: color-mix(in srgb, var(--color-canvas-bg) 70%, var(--color-gold));
        border-color: color-mix(in srgb, var(--color-gold) 85%, var(--color-dark-blue));
    }

    .place-order-btn:disabled {
        cursor: not-allowed;
        opacity: 0.5;
        box-shadow: none;
        background: color-mix(in srgb, var(--color-canvas-bg) 88%, #ccc);
        border-color: color-mix(in srgb, var(--color-gold) 25%, #ccc);
        color: var(--color-dark-gray);
    }

    .error-box {
        background: rgba(185, 28, 28, 0.08);
        border: 1px solid rgba(185, 28, 28, 0.25);
        color: #b91c1c;
        padding: 12px 14px;
        border-radius: 16px;
        font-weight: 900;
    }

    .success-box {
        width: 100%;
        border-radius: 22px;
        padding: 18px 16px;
        border: 1px solid rgba(198, 178, 154, 0.55);
        background: rgba(198, 178, 154, 0.14);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        box-sizing: border-box;
    }

    .success-check {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: flex;
        justify-content: center;
        align-items: center;
        background: #C6B29A;
        color: #1E1E1E;
        font-weight: 1000;
        font-size: 20px;
    }

    .success-text {
        font-weight: 1000;
        font-size: 26px;
        color: #1E1E1E;
        text-align: center;
    }

    .success-sub {
        margin-top: 6px;
        font-weight: 900;
        font-size: 13px;
        color: #475160;
    }

    .success-order-num {
        margin-top: 12px;
        font-weight: 800;
        font-size: 15px;
        color: #1e1e1e;
        letter-spacing: 0.02em;
    }

    .inline-loading {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-items: center;
        font-weight: 1000;
        color: #1E1E1E;
        padding: 10px 0 0;
    }

    .inline-loader {
        width: 120px;
        height: 8px;
        border-radius: 999px;
        background: rgba(63, 82, 79, 0.15);
        border: 1px solid rgba(63, 82, 79, 0.2);
        overflow: hidden;
        position: relative;
    }

    .inline-loader::before {
        content: '';
        position: absolute;
        inset: 0;
        width: 45%;
        border-radius: 999px;
        background: linear-gradient(90deg, #3F524F, #475160);
        animation: tealNavySweep 1.0s infinite linear;
    }

    @keyframes tealNavySweep {
        0% { transform: translateX(-120%); }
        100% { transform: translateX(220%); }
    }

    @media (max-width: 900px) {
        .checkout-page {
            padding: 24px 20px 28px;
        }

        .checkout-container {
            padding: 18px 16px;
            border-radius: 18px;
        }

        .checkout-grid {
            grid-template-columns: 1fr;
            gap: 20px;
        }

        .summary-card {
            border-radius: 20px;
            max-height: none;
        }

        .forms-card {
            width: 100%;
            max-width: 100%;
            padding: 20px;
            border: 1px solid #e5e5e5;
            border-radius: 20px;
            background: #fff;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
        }

        .forms-inner {
            padding: 0;
        }

        .checkout-cta-bar {
            position: static;
            padding: 0;
            background: transparent;
            border: none;
            box-shadow: none;
        }

        .name-row {
            flex-direction: row;
            flex-wrap: nowrap;
            gap: 12px;
            align-items: flex-end;
        }

        .name-row .input-group {
            flex: 1 1 0;
            min-width: 0;
        }

        .city-street-row,
        .house-apt-row {
            flex-direction: row;
            flex-wrap: nowrap;
            gap: 10px;
            align-items: flex-end;
        }

        .city-street-row .input-group,
        .house-apt-row .input-group {
            flex: 1 1 0;
            min-width: 0;
        }

        /* Mobile: compact "select" (autocomplete) controls to avoid unnecessary inner scrolling */
        .suggest-list {
            max-height: min(320px, 55vh);
            border-radius: 16px;
        }

        .suggest-item {
            padding: clamp(8px, 2.6vw, 10px) clamp(10px, 3.2vw, 14px);
            font-size: clamp(12px, 3.6vw, 14px);
        }
    }
</style>

