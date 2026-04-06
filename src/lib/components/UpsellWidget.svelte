<script>
    import { magnets, editorSettings, PACKAGES, EXTRA_MAGNET_PRICE, saveWorkspaceToCart, editingItemId, PRODUCT_TYPES } from '$lib/stores.js';
    import { fly, fade, scale } from 'svelte/transition';

    // זיהוי סוג המוצר הנוכחי
    $: isMosaic = $editorSettings.currentProductType === PRODUCT_TYPES.MOSAIC;
    
    // ספירה: במגנטים רגילים זה מספר התמונות, בפסיפס זה מספר החלקים
    $: count = $magnets.filter(m => !m.hidden).length;
    $: isEditing = !!$editingItemId;

    // --- חישובי מחיר וסטטוס ---
    let totalPrice = 0;
    let basePrice = 0;
    let extraCount = 0;
    let currentPackage = null;
    let nextPackage = null;
    let isMinReached = false;
    let progressPercent = 0;
    let message = '';
    let isSaving = false;

    $: {
        if (isMosaic) {
            // --- לוגיקה לפסיפס ---
            currentPackage = PACKAGES[0]; 
            isMinReached = count >= 9; // מינימום לפסיפס 3x3
            
            if (count < 9) {
                totalPrice = currentPackage.price;
                message = "מינימום 9 חלקים";
            } else {
                extraCount = count - 9;
                basePrice = currentPackage.price;
                totalPrice = basePrice + (extraCount * EXTRA_MAGNET_PRICE);
                message = `פסיפס בגודל ${count} חלקים`;
            }
        } else {
            // --- לוגיקה לקולקציית מגנטים ---
            isMinReached = count >= PACKAGES[0].count;
            
            const reversedPackages = [...PACKAGES].reverse();
            currentPackage = reversedPackages.find(p => count >= p.count) || PACKAGES[0];
            
            const actualCurrentPkg = PACKAGES.find(p => p.name === currentPackage.name);
            const actualIndex = PACKAGES.indexOf(actualCurrentPkg);
            nextPackage = PACKAGES[actualIndex + 1] || null;

            if (!isMinReached) {
                totalPrice = PACKAGES[0].price;
                extraCount = 0;
                message = `עוד <strong>${PACKAGES[0].count - count}</strong> להזמנה`;
            } else {
                extraCount = count - currentPackage.count;
                basePrice = currentPackage.price;
                totalPrice = basePrice + (extraCount * EXTRA_MAGNET_PRICE);
                
                if (nextPackage) {
                    const diff = nextPackage.count - count;
                    if (diff === 0) message = "בול על החבילה! 🎉";
                    else if (diff <= 3) message = `רק עוד <strong>${diff}</strong> למחיר מעולה`;
                    else message = `היעד הבא: ${nextPackage.count} יח'`;
                } else {
                    message = "הגעת למקסימום ✨";
                }
            }

            // חישוב אחוזים לציר
            const totalSteps = PACKAGES.length;
            const stepSize = 100 / (totalSteps - 1);
            
            if (!isMinReached) {
                progressPercent = (count / PACKAGES[0].count) * 10; 
            } else if (nextPackage) {
                const startStep = actualIndex * stepSize;
                const itemsRange = nextPackage.count - currentPackage.count;
                const itemsProgress = count - currentPackage.count;
                progressPercent = startStep + ((itemsProgress / itemsRange) * stepSize);
            } else {
                progressPercent = 100;
            }
        }
    }

    // --- ניהול תצוגה ---
    let isOpen = false;

    function toggleOpen() { isOpen = !isOpen; }
    function close() { isOpen = false; }

    async function handleAddToCart() {
        if (isMinReached) {
            isSaving = true;
            const success = await saveWorkspaceToCart();
            isSaving = false;
            if (success) close();
        }
    }

    /** פורטל ל-body — הדוק משתמש ב-transform ולכן fixed בתוכו נשבר במובייל */
    function portal(node) {
        const target = document.body;
        target.appendChild(node);
        return {
            destroy() {
                if (node.parentNode) node.parentNode.removeChild(node);
            }
        };
    }
</script>

{#if isOpen}
    <div
        class="backdrop-click-area"
        use:portal
        on:click={close}
        transition:fade={{ duration: 200 }}
        role="presentation"
    ></div>
    <div class="upsell-popover" use:portal transition:fly={{ y: 24, duration: 250 }} on:click|stopPropagation>
        <div class="popover-header">
            <div class="header-content">
                <span class="status-msg">{@html message}</span>
                <span class="count-display">סה"כ {count} {isMosaic ? 'חלקים' : 'תמונות'}</span>
            </div>
        </div>

        <div class="popover-body theme-scroll">
            {#if !isMosaic}
                <div class="timeline-wrapper">
                    <div class="track"></div>
                    <div class="fill" style="width: {progressPercent}%"></div>

                    {#each PACKAGES as pkg, i}
                        {@const isPassed = count >= pkg.count}
                        {@const isCurrentTarget = (nextPackage && nextPackage.count === pkg.count) || (currentPackage.count === pkg.count && extraCount === 0)}

                        <div class="dot-container" style="left: {(i / (PACKAGES.length - 1)) * 100}%">
                            <div class="dot" class:passed={isPassed} class:target={isCurrentTarget}>
                                {pkg.count}
                            </div>
                            {#if isCurrentTarget}
                                <div class="price-tag-floating">₪{pkg.price}</div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/if}

            <div class="price-details">
                {#if isMinReached}
                    <div class="detail-row">
                        <span>{isMosaic ? 'מחיר בסיס (9 חלקים)' : `חבילת ${currentPackage.name}`}</span>
                        <span>₪{currentPackage.price}</span>
                    </div>
                    {#if extraCount > 0}
                        <div class="detail-row extra">
                            <span>+ {extraCount} {isMosaic ? 'חלקים' : 'תמונות'} (₪{EXTRA_MAGNET_PRICE}/יח')</span>
                            <span>₪{extraCount * EXTRA_MAGNET_PRICE}</span>
                        </div>
                    {/if}
                {:else}
                    <div class="detail-row warning">
                        <span>מינימום להזמנה</span>
                        <span>{isMosaic ? '9 חלקים' : '9 תמונות'}</span>
                    </div>
                {/if}
            </div>
        </div>

        <div class="popover-footer">
            <div class="total-wrapper">
                <span class="label">סה"כ:</span>
                <span class="amount">₪{totalPrice}</span>
            </div>

            <button
                class="add-to-cart-btn"
                class:disabled={!isMinReached || isSaving}
                on:click={handleAddToCart}
            >
                {#if isSaving}
                    <span class="btn-text">שומר...</span>
                {:else if isMinReached}
                    {#if isEditing}
                        <span class="btn-text">עדכן הזמנה</span>
                        <div class="icon-circle">✓</div>
                    {:else}
                        <span class="btn-text">הוסף להזמנה</span>
                        <div class="icon-circle">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </div>
                    {/if}
                {:else}
                    השלם למינימום
                {/if}
            </button>
        </div>

        <div class="arrow-down"></div>
    </div>
{/if}

<div class="widget-wrapper" data-tooltip={isEditing ? "שמור עדכון להזמנה" : "הוסף לסל"}>
    <button 
        class="trigger-circle" 
        class:active={isOpen}
        class:is-editing={isEditing}
        on:click={toggleOpen}
    >
        <div class="bag-icon-wrapper">
            {#if isEditing}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="edit-order-icon">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                    
                    <path d="M8 12h8" stroke-width="1.5" opacity="0.7"></path>
                    <path d="M8 16h5" stroke-width="1.5" opacity="0.7"></path>

                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" 
                          transform="translate(-2, 2) scale(0.8)" 
                          fill="var(--color-gold)" 
                          stroke="var(--color-canvas-bg)" 
                          stroke-width="1.5">
                    </path>
                </svg>
            {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
                    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                    <line x1="3" y1="6" x2="21" y2="6"></line>
                    <path d="M16 10a4 4 0 0 1-8 0"></path>
                </svg>
                <div class="plus-mini">+</div>
            {/if}
        </div>
        
        {#if count > 0}
            <div class="floating-badge count-badge" transition:scale key={count}>
                {count}
            </div>
        {/if}
    </button>

</div>

<style>
    .widget-wrapper { position: relative; display: flex; justify-content: center; align-items: center; }
    .backdrop-click-area {
        position: fixed;
        inset: 0;
        z-index: 4600;
        background: transparent;
        cursor: default;
        min-height: 100vh;
        min-height: 100dvh;
    }
    
    .trigger-circle { 
        width: 50px; height: 50px; border-radius: 50%; 
        background: var(--color-pink); 
        border: 3px solid rgba(255,255,255,0.3); 
        color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; 
        box-shadow: 0 4px 15px rgba(0,0,0,0.2); 
        position: relative; z-index: 2000; 
        transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); 
    }
    
    .trigger-circle:active { transform: scale(0.95); }
    .trigger-circle.active { background: #2c3a38; }
    
    /* 🔥 עיצוב מיוחד למצב עריכה: מסגרת זהב כדי להדגיש שמדובר בשינוי קיים */
    .trigger-circle.is-editing {
        border-color: var(--color-gold); 
        box-shadow: 0 0 15px rgba(198, 178, 154, 0.4); /* זוהר עדין בצבע הזהב */
    }

    .bag-icon-wrapper { position: relative; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; }
    
    .edit-order-icon {
        width: 24px; 
        height: 24px;
        filter: drop-shadow(0 2px 3px rgba(0,0,0,0.2)); /* צל קטן לאייקון לשיפור הקריאות */
    }

    .plus-mini { position: absolute; bottom: -3px; right: -3px; width: 12px; height: 12px; background: white; color: var(--color-pink); font-size: 12px; font-weight: 800; border-radius: 50%; display: flex; align-items: center; justify-content: center; line-height: 1; }
    
    /* העיצוב של הבאדג' עם המספר */
    .floating-badge { 
        position: absolute; top: -4px; left: -4px; 
        font-weight: 700; font-size: 11px; 
        min-width: 18px; height: 18px; border-radius: 50%; 
        display: flex; align-items: center; justify-content: center; 
        border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2); 
    }
    
    .count-badge { background: var(--color-gold); color: var(--color-dark-blue); }
    
    /* שאר ה-CSS נשאר ללא שינוי */
    .upsell-popover {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        bottom: calc(100px + env(safe-area-inset-bottom, 0px) + var(--vv-bottom-chrome, 0px));
        width: 340px;
        max-width: calc(100vw - 20px);
        max-height: min(62vh, 480px);
        background: white;
        border-radius: 16px;
        box-shadow: 0 10px 50px rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(0, 0, 0, 0.05);
        z-index: 4601;
        display: flex;
        flex-direction: column;
        font-family: 'Assistant', sans-serif;
        cursor: default;
        overflow: hidden;
    }
    .arrow-down { position: absolute; bottom: -6px; left: 50%; margin-left: -6px; width: 12px; height: 12px; background: white; transform: rotate(45deg); border-bottom: 1px solid rgba(0,0,0,0.05); border-right: 1px solid rgba(0,0,0,0.05); z-index: 5001; }
    .popover-header { padding: 12px 15px; background: #f8f9fa; border-bottom: 1px solid #eee; }
    .header-content { display: flex; justify-content: space-between; align-items: center; }
    .status-msg { font-size: 14px; color: var(--color-ink); }
    .status-msg :global(strong) { color: var(--color-pink); font-weight: 800; }
    .count-display { font-size: 12px; color: #888; font-weight: 600; }
    .popover-body { padding: 15px; overflow-y: auto; max-height: 300px; }
    .timeline-wrapper { position: relative; height: 50px; width: 92%; margin: 10px auto 20px auto; direction: ltr; }
    .track { position: absolute; top: 12px; left: 0; width: 100%; height: 4px; background: #eee; border-radius: 2px; }
    .fill { position: absolute; top: 12px; left: 0; height: 4px; background: var(--color-pink); border-radius: 2px; transition: width 0.3s ease; }
    .dot-container { position: absolute; top: 5px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; }
    .dot { width: 18px; height: 18px; background: white; border: 2px solid #ddd; border-radius: 50%; font-size: 9px; color: #aaa; font-weight: 700; display: flex; align-items: center; justify-content: center; z-index: 2; transition: all 0.2s; }
    .dot.passed { background: var(--color-pink); border-color: var(--color-pink); color: white; }
    .dot.target { transform: scale(1.3); border-color: var(--color-gold); color: var(--color-dark-blue); background: #fff8e1; box-shadow: 0 0 0 3px rgba(198, 178, 154, 0.2); }
    .price-tag-floating { position: absolute; top: 24px; font-size: 10px; background: var(--color-gold); color: white; padding: 1px 4px; border-radius: 4px; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .price-details { display: flex; flex-direction: column; gap: 8px; font-size: 14px; color: #333; margin-top: 10px; }
    .detail-row { display: flex; justify-content: space-between; border-bottom: 1px dashed #eee; padding-bottom: 4px; }
    .detail-row:last-child { border-bottom: none; }
    .detail-row.extra { color: var(--color-pink); font-weight: 600; }
    .detail-row.warning { color: #d32f2f; }
    .popover-footer { padding: 15px; background: #fff; border-top: 1px solid #eee; display: flex; flex-direction: column; gap: 12px; }
    .total-wrapper { display: flex; justify-content: space-between; align-items: center; font-size: 16px; }
    .total-wrapper .label { color: #555; font-weight: 600; }
    .total-wrapper .amount { font-weight: 800; color: var(--color-ink); font-size: 20px; }
    .add-to-cart-btn { width: 100%; padding: 14px; background: #1E1E1E; color: white; border: none; border-radius: 10px; font-weight: 700; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; transition: background 0.2s; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
    .add-to-cart-btn:hover { background: #000; }
    .add-to-cart-btn.disabled { background: #e0e0e0; color: #999; cursor: not-allowed; box-shadow: none; }
    .icon-circle { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; }
    @media (max-width: 768px) {
        .upsell-popover {
            width: min(94vw, 360px);
            bottom: calc(96px + env(safe-area-inset-bottom, 0px) + var(--vv-bottom-chrome, 0px));
            max-height: min(58vh, 440px);
        }
        .popover-body {
            max-height: min(38vh, 260px);
        }
    }
</style>