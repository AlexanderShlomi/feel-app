
<script>
    //src\lib\components\CartCounter.svelte
    
    import { onDestroy, onMount } from 'svelte';
    import { cart, cartTotal, removeCartItem, editCartItem, PRODUCT_TYPES, isMobile, setUploaderScrollActive } from '$lib/stores.js';
    import { goto } from '$app/navigation';
    import { fly, fade, slide } from 'svelte/transition';
    import {
        setCheckoutPrivacyConsent,
        clearCheckoutPrivacyConsent,
        requestOpenPrivacyPolicy,
        requestOpenCookiePolicy
    } from '$lib/privacyCheckoutConsent.js';
    import { user, profile, authLoading, refreshProfile } from '$lib/authStore';
    import {
        currentPrivacyPolicy,
        recordPrivacyConsent,
        privacyNeedsReaccept
    } from '$lib/privacyPolicyStore.js';

    /** אורח: חובה לסמן. מחובר: רק אם חסרה חתימה לגרסה העדכנית ב-DB */
    let privacyReadChecked = false;

    $: showPrivacyRowInCart =
        !$user || ($user && !$authLoading && privacyNeedsReaccept($profile, $currentPrivacyPolicy));

    /** מחובר וכבר חתם על הגרסה הנוכחית — בלי בוי ובלי חסימה */
    $: checkoutPrivacyOk =
        !$authLoading &&
        ($user
            ? !privacyNeedsReaccept($profile, $currentPrivacyPolicy) || privacyReadChecked
            : privacyReadChecked);

    $: items = $cart;
    $: count = items.length;
    $: total = $cartTotal;

    let isOpen = false; 
    let prefersReducedMotion = false;

    // iOS Safari: prevent viewport/scrollbar churn while the drawer is open.
    let prevBodyOverflow = '';
    let prevHtmlOverflow = '';
    let prevBodyOverscroll = '';
    let scrollLocked = false;

    function lockBodyScroll() {
        if (typeof document === 'undefined') return;
        if (scrollLocked) return;
        const body = document.body;
        const html = document.documentElement;
        if (!body || !html) return;

        prevBodyOverflow = body.style.overflow;
        prevHtmlOverflow = html.style.overflow;
        // @ts-ignore - not in older TS lib dom typings
        prevBodyOverscroll = body.style.overscrollBehavior || '';

        body.style.overflow = 'hidden';
        html.style.overflow = 'hidden';
        // @ts-ignore
        body.style.overscrollBehavior = 'contain';
        scrollLocked = true;
    }

    function unlockBodyScroll() {
        if (typeof document === 'undefined') return;
        if (!scrollLocked) return;
        const body = document.body;
        const html = document.documentElement;
        if (body) {
            body.style.overflow = prevBodyOverflow || '';
            // @ts-ignore
            body.style.overscrollBehavior = prevBodyOverscroll || '';
        }
        if (html) {
            html.style.overflow = prevHtmlOverflow || '';
        }
        scrollLocked = false;
    }

    $: if (isOpen) lockBodyScroll();
    $: if (!isOpen) unlockBodyScroll();

    onMount(() => {
        try {
            const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
            if (mq) {
                prefersReducedMotion = !!mq.matches;
                const onChange = (e) => (prefersReducedMotion = !!e.matches);
                mq.addEventListener?.('change', onChange);
                return () => mq.removeEventListener?.('change', onChange);
            }
        } catch {}
        return undefined;
    });

    onDestroy(() => {
        if (uploaderGateReleaseTimer) clearTimeout(uploaderGateReleaseTimer);
        uploaderGateReleaseTimer = null;
        unlockBodyScroll();
        try { setUploaderScrollActive(false); } catch {}
    });

    // Portal drawer/backdrop to <body> to avoid stacking-context issues (transforms)
    // and guarantee the cart sits above fixed docks on all pages.
    function portal(node) {
        let target = document.body;
        async function update() {
            target.appendChild(node);
            node.hidden = false;
        }
        update();
        return {
            destroy() {
                if (node.parentNode) node.parentNode.removeChild(node);
            }
        };
    }

    function toggleCart() {
        isOpen = !isOpen;
        if (isOpen) privacyReadChecked = false;
        // Mobile-only: opening/closing overlays on iOS can cause viewport churn.
        // Treat it like "active scroll" so uploader image swaps are deferred.
        try { if ($isMobile) setUploaderScrollActive(isOpen); } catch {}
    }
    
    let uploaderGateReleaseTimer;
    function closeCart() {
        isOpen = false;
        try {
            if ($isMobile) {
                // Give the close transition / viewport settling a moment before releasing.
                if (uploaderGateReleaseTimer) clearTimeout(uploaderGateReleaseTimer);
                uploaderGateReleaseTimer = setTimeout(() => {
                    uploaderGateReleaseTimer = null;
                    try { setUploaderScrollActive(false); } catch {}
                }, 460);
            }
        } catch {}
    }
    
    function handleEdit(itemId) {
        editCartItem(itemId);
        closeCart();
    }

    function handleDelete(itemId) {
        if (confirm('בטוח שאתה רוצה להסיר את הפריט מהסל?')) {
            removeCartItem(itemId);
            if ($cart.length === 0) isOpen = false;
        }
    }

    function goCreate() {
        closeCart();
        goto('/select');
    }

    async function onPrivacyCheckboxChange(/** @type {Event & { currentTarget: HTMLInputElement }} */ e) {
        const checked = e.currentTarget.checked;
        privacyReadChecked = checked;
        if (!$user) {
            if (checked) setCheckoutPrivacyConsent();
            else clearCheckoutPrivacyConsent();
            return;
        }
        if (!checked) return;
        if (!privacyNeedsReaccept($profile, $currentPrivacyPolicy)) return;
        const err = await recordPrivacyConsent();
        if (err) {
            privacyReadChecked = false;
            e.currentTarget.checked = false;
            console.error('recordPrivacyConsent:', err);
            return;
        }
        if ($user?.id) await refreshProfile($user.id);
    }

    function openPrivacyModal() {
        requestOpenPrivacyPolicy();
    }

    function openCookiePolicyModal() {
        requestOpenCookiePolicy();
    }

    function goCheckout() {
        if (!checkoutPrivacyOk) return;
        if (!$user) setCheckoutPrivacyConsent();
        closeCart();
        goto('/checkout');
    }
</script>

<button 
    class="header-cart-btn" 
    class:is-empty={count === 0}
    on:click={toggleCart}
    title="פתח את הסל"
>
    <div class="icon-wrapper">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
            <circle cx="9" cy="21" r="1"></circle>
            <circle cx="20" cy="21" r="1"></circle>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
        </svg>
        
        {#if count > 0}
            <div class="badge" transition:fade>{count}</div>
        {/if}
    </div>
    
    {#if count > 0}
        <span class="cart-price" transition:slide={{ axis: 'x' }}>₪{total}</span>
    {/if}
</button>

{#if isOpen}
    <div
        class="backdrop"
        role="button"
        tabindex="0"
        aria-label="סגור סל"
        on:click={closeCart}
        on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') closeCart(); }}
        transition:fade={{ duration: ($isMobile || prefersReducedMotion) ? 120 : 200 }}
        use:portal
    ></div>

    <div
        class="cart-drawer"
        transition:fly={{ x: ($isMobile || prefersReducedMotion) ? -260 : -350, duration: ($isMobile || prefersReducedMotion) ? 180 : 300, opacity: 1 }}
        use:portal
    >
        
        <div class="drawer-header">
            <h2>הסל שלי <span class="header-count">({count})</span></h2>
            <button class="close-btn" on:click={closeCart} aria-label="סגור סל">&times;</button>
        </div>

        <div class="drawer-content theme-scroll">
            {#if count === 0}
                <div class="empty-state" transition:fade>
                    <div class="empty-icon">🛒</div>
                    <h3>הסל שלך ריק</h3>
                    <p>זה הזמן למלא אותו בזיכרונות!</p>
                    <button class="cta-btn" on:click={goCreate}>התחל לעצב</button>
                </div>
            {:else}
                <div class="cart-items-list">
                    {#each items as item (item.id)}
                        
                        {#if item.type === PRODUCT_TYPES.GIFT}
                            <div class="cart-item gift-item" transition:slide={{ duration: ($isMobile || prefersReducedMotion) ? 0 : 220 }}>
                                <div class="item-image gift-border">
                                    <img src={item.previewImage} alt="Gift" loading="eager" decoding="async" />
                                    <div class="gift-icon-overlay">🎁</div>
                                </div>
                                <div class="item-details">
                                    <div class="item-top">
                                        <span class="item-title highlight-gift">{item.title}</span>
                                        <button class="delete-item-btn" on:click={() => handleDelete(item.id)}>✕</button>
                                    </div>
                                    <span class="item-subtitle">{item.subtitle}</span>
                                    
                                    <div class="item-bottom">
                                        <button class="edit-pill-btn" on:click={() => handleEdit(item.id)}>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                                            <span>החלף תמונה</span>
                                        </button>
                                        <span class="item-price free">חינם</span>
                                    </div>
                                </div>
                            </div>

                        {:else if item.type === PRODUCT_TYPES.MOSAIC}
                            <div class="cart-item mosaic-item" transition:slide={{ duration: ($isMobile || prefersReducedMotion) ? 0 : 220 }}>
                                <div class="item-image mosaic-border">
                                    <img src={item.previewImage} alt="Mosaic" loading="eager" decoding="async" />
                                    <div class="type-badge">פסיפס</div>
                                </div>
                                <div class="item-details">
                                    <div class="item-top">
                                        <span class="item-title">{item.title}</span>
                                        <button class="delete-item-btn" on:click={() => handleDelete(item.id)}>✕</button>
                                    </div>
                                    <span class="item-subtitle">{item.subtitle}</span>
                                    
                                    <div class="item-bottom">
                                        <button class="edit-pill-btn" on:click={() => handleEdit(item.id)}>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                                            <span>ערוך עיצוב</span>
                                        </button>
                                        <span class="item-price">₪{item.price}</span>
                                    </div>
                                </div>
                            </div>

                        {:else}
                            <div class="cart-item" transition:slide={{ duration: ($isMobile || prefersReducedMotion) ? 0 : 220 }}>
                                <div class="item-image">
                                    {#if item.previewImage}
                                        <img src={item.previewImage} alt="Preview" loading="eager" decoding="async" />
                                    {:else}
                                        <div class="no-img">📷</div>
                                    {/if}
                                </div>
                                <div class="item-details">
                                    <div class="item-top">
                                        <span class="item-title">{item.title}</span>
                                        <button class="delete-item-btn" on:click={() => handleDelete(item.id)}>✕</button>
                                    </div>
                                    <span class="item-subtitle">{item.subtitle}</span>
                                    
                                    <div class="item-bottom">
                                        <button class="edit-pill-btn" on:click={() => handleEdit(item.id)}>
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                                            <span>ערוך עיצוב</span>
                                        </button>
                                        <span class="item-price">₪{item.price}</span>
                                    </div>
                                </div>
                            </div>
                        {/if}

                    {/each}
                </div>
            {/if}
        </div>

        {#if count > 0}
            <div class="drawer-footer">
                <div class="summary-line">
                    <span>משלוח מהיר</span>
                    <span class="green-text">חינם</span>
                </div>
                <div class="summary-line total">
                    <span>סה"כ לתשלום</span>
                    <span class="leather-total">₪{total}</span>
                </div>

                {#if showPrivacyRowInCart}
                    <div class="privacy-checkout-row">
                        <label class="privacy-label">
                            <input
                                type="checkbox"
                                checked={privacyReadChecked}
                                disabled={$authLoading}
                                on:change={onPrivacyCheckboxChange}
                            />
                            <span class="privacy-label-text">
                                קראתי והסכמתי ל־
                                <button type="button" class="privacy-link" on:click|stopPropagation={openPrivacyModal}>
                                    מדיניות הפרטיות
                                </button>
                                לפני מעבר לתשלום.
                                מידע על אחסון מקומי:
                                <button
                                    type="button"
                                    class="privacy-link"
                                    on:click|stopPropagation={openCookiePolicyModal}
                                >
                                    מדיניות קובצי Cookie
                                </button>
                            </span>
                        </label>
                    </div>
                {/if}

                <button
                    type="button"
                    class="checkout-btn-full"
                    class:checkout-disabled={!checkoutPrivacyOk}
                    disabled={!checkoutPrivacyOk}
                    on:click={goCheckout}
                >
                    מעבר לתשלום מאובטח
                </button>
            </div>
        {/if}
    </div>
{/if}

<style>
    .header-cart-btn {
        background: transparent;
        border: 1px solid rgba(198, 178, 154, 0.3);
        color: var(--color-gold);
        display: flex; align-items: center; gap: 8px;
        padding: 5px 12px;
        border-radius: 20px;
        cursor: pointer;
        transition: all 0.2s;
        font-family: 'Assistant', sans-serif;
        height: 40px;
    }
    
    .header-cart-btn:hover {
        border-color: var(--color-gold);
        background: rgba(255,255,255,0.05);
        color: white;
    }

    .header-cart-btn.is-empty {
        opacity: 0.7; /* שקיפות עדינה יותר */
    }

    .icon-wrapper { position: relative; display: flex; align-items: center; }
    
    .badge { 
        position: absolute; top: -8px; right: -8px; 
        background: var(--color-pink); color: white; 
        font-size: 10px; font-weight: 700; 
        width: 16px; height: 16px; 
        border-radius: 50%; 
        display: flex; justify-content: center; align-items: center; 
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    }

    .cart-price {
        font-weight: 700; font-size: 15px; color: #fff; white-space: nowrap;
    }

    /* --- Drawer --- */
    .backdrop {
        position: fixed;
        inset: 0;
        width: auto;
        height: auto;
        min-height: 100vh;
        min-height: 100dvh;
        background: rgba(0, 0, 0, 0.4);
        z-index: 6500 !important;
        backdrop-filter: blur(4px);
        cursor: pointer;
    }
    .cart-drawer {
        position: fixed;
        top: 0;
        left: 0;
        width: 360px;
        max-width: 85%;
        height: 100vh;
        height: 100dvh;
        max-height: 100dvh;
        background: #fff;
        color: #1e1e1e;
        z-index: 6501 !important;
        box-shadow: 5px 0 40px rgba(0, 0, 0, 0.1);
        display: flex;
        flex-direction: column;
        direction: rtl;
        overflow: hidden;
    }

    .drawer-header {
        flex-shrink: 0;
        padding: 20px;
        padding-top: max(20px, calc(12px + env(safe-area-inset-top, 0px)));
        border-bottom: 1px solid #eee;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #f9f9f9;
    }
    .drawer-header h2 { margin: 0; font-size: 18px; font-weight: 800; }
    .close-btn { background: none; border: none; color: var(--color-gold); font-size: 32px; line-height: 1; cursor: pointer; padding: 4px 8px; }

    .drawer-content {
        flex: 1;
        min-height: 0;
        padding: 20px;
        overflow-y: auto;
    }
    
    /* --- Empty State --- */
    .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; color: #888; }
    .empty-icon { font-size: 40px; margin-bottom: 15px; opacity: 0.5; }
    .empty-state h3 { margin: 0; color: #333; }
    .cta-btn { margin-top: 20px; background: var(--color-pink); color: white; border: none; padding: 10px 25px; border-radius: 20px; font-weight: 700; cursor: pointer; }

    .cart-items-list { display: flex; flex-direction: column; gap: 15px; }
    
    .cart-item { display: flex; gap: 10px; border: 1px solid #eee; padding: 10px; border-radius: 8px; background: white; }
    
    /* Gift specific styles */
    .cart-item.gift-item { background: #f0f7f6; border-color: #b2dfdb; }
    .highlight-gift { color: var(--color-teal); font-weight: 800; }
    .item-price.free { color: var(--color-teal); }
    .gift-border { border: 2px solid var(--color-gold); position: relative; }
    .gift-icon-overlay { position: absolute; bottom: 0; right: 0; background: white; width: 16px; height: 16px; border-radius: 50% 0 4px 0; font-size: 10px; display: flex; align-items: center; justify-content: center; }

    /* Mosaic specific styles */
    .cart-item.mosaic-item { background: #fffbf5; border-color: #eaddcf; }
    .mosaic-border { position: relative; }
    .type-badge { position: absolute; bottom: 0; left: 0; width: 100%; background: rgba(0,0,0,0.6); color: white; font-size: 9px; text-align: center; padding: 2px 0; }

    .item-image { width: 60px; height: 60px; background: #eee; border-radius: 4px; overflow: hidden; flex-shrink: 0; position: relative; }
    .item-image img { width: 100%; height: 100%; object-fit: cover; }
    .no-img { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
    
    .item-details { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .item-top { display: flex; justify-content: space-between; }
    .item-title { font-weight: 700; font-size: 14px; }
    .delete-item-btn { background: none; border: none; color: #999; cursor: pointer; padding: 0 5px; }
    .delete-item-btn:hover { color: red; }
    .item-subtitle { font-size: 12px; color: #666; }
    
    .item-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; font-size: 14px; }
    .item-price { font-weight: 700; }

    /* 🔥 עיצוב חדש לכפתור העריכה 🔥 */
    .edit-pill-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: transparent;
        border: 1px solid #ddd;
        padding: 4px 10px;
        border-radius: 12px;
        font-family: 'Assistant', sans-serif;
        font-size: 11px;
        font-weight: 600;
        color: var(--color-medium-blue-gray);
        cursor: pointer;
        transition: all 0.2s;
    }

    .edit-pill-btn svg {
        width: 12px;
        height: 12px;
    }

    .edit-pill-btn:hover {
        border-color: var(--color-pink);
        color: var(--color-pink);
        background: #f9f9f9;
        transform: translateY(-1px);
        box-shadow: 0 2px 5px rgba(0,0,0,0.05);
    }

    .drawer-footer {
        flex-shrink: 0;
        padding: 20px;
        padding-bottom: max(20px, calc(20px + env(safe-area-inset-bottom, 0px)));
        border-top: 1px solid #eee;
        background: #f9f9f9;
    }
    .summary-line { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
    .green-text { color: #3F524F; font-weight: bold; }
    .summary-line.total { font-size: 18px; font-weight: 800; margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd; }
    .privacy-checkout-row {
        margin-top: 14px;
        padding: 12px 10px;
        background: #f5f2ed;
        border: 1px solid rgba(198, 178, 154, 0.35);
        border-radius: 10px;
    }
    .privacy-label {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
        color: #1e1e1e;
        line-height: 1.45;
        text-align: right;
    }
    .privacy-label input {
        margin-top: 3px;
        flex-shrink: 0;
        width: 18px;
        height: 18px;
        accent-color: var(--color-teal, #3f524f);
    }
    .privacy-label-text { flex: 1; min-width: 0; }
    .privacy-link {
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
    .privacy-link:hover { color: #1e1e1e; }

    .checkout-btn-full { width: 100%; padding: 14px; background: #1E1E1E; color: white; border: none; border-radius: 6px; font-weight: 700; font-size: 16px; margin-top: 15px; cursor: pointer; transition: background 0.2s; }
    .checkout-btn-full:hover:not(:disabled) { background: black; }
    .checkout-btn-full.checkout-disabled,
    .checkout-btn-full:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
</style>