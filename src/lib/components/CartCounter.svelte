<script>
    import { visibleMagnets, PACKAGES, EXTRA_MAGNET_PRICE } from '$lib/stores.js';
    import { page } from '$app/stores';
    import { fly, fade, slide } from 'svelte/transition';

    $: count = $visibleMagnets.length;

    // --- לוגיקה עסקית ---
    let currentPackage = null;
    let nextPackage = null;
    let totalPrice = 0;
    let isUpsellOpportunity = false;
    let missingForMin = 0; // כמה חסר למינימום

    $: {
        // איפוס משתנים
        missingForMin = 0;
        isUpsellOpportunity = false;

        // מצב מתחת למינימום (פחות מ-9)
        if (count < PACKAGES[0].count) {
            currentPackage = null; 
            nextPackage = PACKAGES[0]; // היעד הוא החבילה הראשונה
            totalPrice = PACKAGES[0].price; // מציגים את מחיר המינימום
            missingForMin = PACKAGES[0].count - count;
        } 
        // מצב רגיל (מעל 9)
        else {
            const reversedPackages = [...PACKAGES].reverse();
            currentPackage = reversedPackages.find(p => count >= p.count);
            const currentIndex = PACKAGES.indexOf(currentPackage);
            nextPackage = PACKAGES[currentIndex + 1] || null;

            if (currentPackage) {
                const extraCount = count - currentPackage.count;
                totalPrice = currentPackage.price + (extraCount * EXTRA_MAGNET_PRICE);
                
                if (nextPackage) {
                    isUpsellOpportunity = totalPrice >= (nextPackage.price - 10);
                }
            }
        }
    }

    // --- לוגיקת תצוגה ---
    let isOpen = false; 
    let isPageVisible = false;

    $: {
        const routeId = $page.route.id;
        if (routeId === '/uploader' || routeId === '/uploader/edit/[magnetId]') {
            isPageVisible = true;
        } else {
            isPageVisible = false;
        }
    }

    function toggleCart() { isOpen = !isOpen; }
    function closeCart() { isOpen = false; }
</script>

{#if isPageVisible && count > 0}
    <button class="cart-floating-btn" on:click={toggleCart}>
        <div class="icon-wrapper">
            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                <path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59L3.62 15H19v-2H7l1.1-2h8.31l3.9-7H5.21L4.27 2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
            <div class="badge">{count}</div>
        </div>
        <span class="btn-price">₪{totalPrice}</span>
    </button>

    {#if isOpen}
        <div class="backdrop" on:click={closeCart} transition:fade={{ duration: 200 }}></div>

        <div class="cart-drawer" transition:fly={{ x: -350, duration: 300, opacity: 1 }}>
            
            <div class="drawer-header">
                <h2>הסל שלי <span class="header-count">({count})</span></h2>
                <button class="close-btn" on:click={closeCart}>✕</button>
            </div>

            <div class="drawer-content">
                
                {#if missingForMin > 0}
                    <div class="package-item active incomplete" transition:slide>
                        <div class="pkg-top">
                            <div class="pkg-title-area">
                                <span class="pkg-name">{PACKAGES[0].name}</span>
                                <span class="pkg-units-badge">9 יח'</span>
                            </div>
                            <div class="pkg-price">₪{PACKAGES[0].price}</div>
                        </div>
                        
                        <div class="min-order-alert">
                            <div class="progress-text">
                                עוד <strong>{missingForMin} רגעים</strong> והחבילה הראשונה מוכנה!
                            </div>
                            <div class="progress-bar-bg">
                                <div class="progress-bar-fill" style="width: {(count / 9) * 100}%"></div>
                            </div>
                        </div>
                    </div>
                {/if}

                <div class="packages-list">
                    {#each PACKAGES as pkg}
                        {#if !(missingForMin > 0 && pkg.count === 9)} 
                            {@const isCurrent = currentPackage && currentPackage.name === pkg.name}
                            {@const isNext = nextPackage && nextPackage.name === pkg.name}
                            {@const isPassed = count > pkg.count && !isCurrent}
                            
                            <div class="package-item" class:active={isCurrent} class:passed={isPassed} class:next={isNext}>
                                <div class="pkg-top">
                                    <div class="pkg-title-area">
                                        {#if isCurrent}
                                            <div class="status-icon success">✓</div>
                                        {:else if isPassed}
                                            <div class="status-icon passed">✓</div>
                                        {:else}
                                            <div class="status-icon empty"></div>
                                        {/if}
                                        
                                        <span class="pkg-name">{pkg.name}</span>
                                        <span class="pkg-units-badge">{pkg.count} יח'</span>
                                    </div>
                                    <div class="pkg-price">₪{pkg.price}</div>
                                </div>

                                {#if isCurrent && count > pkg.count}
                                    <div class="pkg-extra-details" transition:slide>
                                        <div class="extra-line">
                                            <span>חבילת בסיס</span>
                                            <span>כלול</span>
                                        </div>
                                        <div class="extra-line highlight">
                                            <span>+ {count - pkg.count} תמונות נוספות</span>
                                            <span>₪{(count - pkg.count) * EXTRA_MAGNET_PRICE}</span>
                                        </div>
                                    </div>
                                {/if}
                            </div>
                            
                            {#if isCurrent && isUpsellOpportunity && nextPackage && nextPackage.name === PACKAGES[PACKAGES.indexOf(pkg)+1]?.name}
                                <div class="upsell-alert" transition:slide>
                                    <div class="upsell-content">
                                        <span class="upsell-icon">✨</span>
                                        <div>
                                            <strong>המלצה חמה:</strong> הוסף עוד {nextPackage.count - count} תמונות וקבל את חבילת 
                                            <span class="leather-text">{nextPackage.name}</span> במחיר משתלם!
                                        </div>
                                    </div>
                                </div>
                            {/if}
                        {/if}
                    {/each}
                </div>

            </div>

            <div class="drawer-footer">
                <div class="summary-line">
                    <span>משלוח מהיר</span>
                    <span class="green-text">חינם</span>
                </div>
                <div class="summary-line total">
                    <span>סה"כ לתשלום</span>
                    <span class="leather-total">₪{totalPrice}</span>
                </div>
                
                <button 
                    class="checkout-btn-full" 
                    disabled={missingForMin > 0}
                    class:disabled={missingForMin > 0}
                >
                    {#if missingForMin > 0}
                        מינימום 9 תמונות להזמנה
                    {:else}
                        מעבר לתשלום מאובטח
                    {/if}
                </button>
            </div>
        </div>
    {/if}
{/if}

<style>

    :global(:root) {
        --color-ink: #1E1E1E;
        --color-sand: #F2F0EC;
        --color-leather: #846349;
        --color-teal: #3F524F;
        --color-white: #FFFFFF;
    }

    /* כפתור צף */
    .cart-floating-btn {
        position: fixed; top: 20px; left: 30px; z-index: 2000;
        background: var(--color-ink); border: 1px solid rgba(255,255,255,0.15);
        color: white; display: flex; align-items: center; gap: 12px;
        padding: 8px 18px; border-radius: 30px; cursor: pointer;
        transition: all 0.2s; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        font-family: 'Assistant', sans-serif; direction: rtl;
    }
    .cart-floating-btn:hover { background: #000; border-color: var(--color-leather); transform: scale(1.02); }
    .icon-wrapper { position: relative; display: flex; align-items: center; }
    .badge { position: absolute; top: -8px; right: -8px; background: var(--color-leather); color: white; font-size: 11px; font-weight: 800; width: 18px; height: 18px; border-radius: 50%; display: flex; justify-content: center; align-items: center; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
    .btn-price { font-weight: 700; font-size: 16px; color: #ddd; }

    /* Backdrop & Drawer */
    .backdrop { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); z-index: 3000; backdrop-filter: blur(4px); }
    .cart-drawer { position: fixed; top: 0; left: 0; width: 360px; max-width: 85%; height: 100vh; background: var(--color-white); color: var(--color-ink); z-index: 3001; box-shadow: 5px 0 40px rgba(0,0,0,0.1); display: flex; flex-direction: column; direction: rtl; font-family: 'Assistant', sans-serif; }

    .drawer-header { padding: 22px 20px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; background: var(--color-sand); }
    .drawer-header h2 { margin: 0; font-size: 20px; font-weight: 800; color: var(--color-ink); }
    .header-count { color: #666; font-weight: 400; font-size: 16px; }
    .close-btn { background: rgba(0,0,0,0.05); border: none; width: 32px; height: 32px; border-radius: 50%; font-size: 16px; cursor: pointer; color: var(--color-ink); display: flex; align-items: center; justify-content: center; transition: background 0.2s; }
    .close-btn:hover { background: rgba(0,0,0,0.1); }

    .drawer-content { flex: 1; padding: 20px; overflow-y: auto; }
    .packages-list { display: flex; flex-direction: column; gap: 10px; }

    .package-item { background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 14px 16px; transition: all 0.2s; }
    .package-item.active { background: #fff; border: 1px solid var(--color-leather); box-shadow: 0 4px 12px rgba(132, 99, 73, 0.15); }
    .package-item.passed { opacity: 0.5; background: #fafafa; }
    
    /* עיצוב מיוחד למצב חוסר (Incomplete) */
    .package-item.incomplete { border-style: dashed; border-color: #bbb; background: #fafafa; }

    .pkg-top { display: flex; justify-content: space-between; align-items: center; }
    .pkg-title-area { display: flex; align-items: center; gap: 10px; }
    .status-icon { width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; }
    .status-icon.success { background: var(--color-leather); color: white; }
    .status-icon.passed { background: #e0e0e0; color: #fff; }
    .status-icon.empty { border: 1px solid #ddd; }
    .pkg-name { font-weight: 700; font-size: 15px; color: var(--color-ink); }
    .pkg-units-badge { background: var(--color-sand); padding: 2px 8px; border-radius: 12px; font-size: 11px; color: #666; font-weight: 600; }
    .pkg-price { font-weight: 700; font-size: 15px; color: var(--color-ink); }

    .pkg-extra-details { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #eee; font-size: 13px; color: #777; }
    .extra-line { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .extra-line.highlight { color: var(--color-leather); font-weight: 600; }

    /* Progress Bar לאיסוף */
    .min-order-alert { margin-top: 12px; }
    .progress-text { font-size: 13px; color: #666; margin-bottom: 6px; }
    .progress-text strong { color: var(--color-leather); }
    .progress-bar-bg { width: 100%; height: 6px; background: #eee; border-radius: 3px; overflow: hidden; }
    .progress-bar-fill { height: 100%; background: var(--color-leather); transition: width 0.3s ease; }

    .upsell-alert { margin-top: 8px; background: #F9F7F4; border: 1px solid #E5DFD5; padding: 12px; border-radius: 8px; color: var(--color-ink); }
    .upsell-content { display: flex; gap: 10px; align-items: start; font-size: 13px; line-height: 1.4; }
    .leather-text { color: var(--color-leather); font-weight: 800; }

    /* Footer */
    .drawer-footer { padding: 20px; background: var(--color-sand); border-top: 1px solid #e0e0e0; }
    .summary-line { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 15px; color: #555; }
    .green-text { color: var(--color-teal); font-weight: 700; }
    .summary-line.total { font-size: 20px; font-weight: 800; margin-bottom: 20px; color: var(--color-ink); border-top: 1px solid rgba(0,0,0,0.05); padding-top: 10px; }
    .leather-total { color: var(--color-leather); }

    .checkout-btn-full { width: 100%; padding: 16px; background: var(--color-ink); color: white; font-size: 18px; font-weight: 700; border: none; border-radius: 8px; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
    .checkout-btn-full:hover { background: #000; transform: translateY(-2px); }
    
    /* Disabled State */
    .checkout-btn-full.disabled { background: #ccc; cursor: not-allowed; transform: none; box-shadow: none; color: #666; }
</style>