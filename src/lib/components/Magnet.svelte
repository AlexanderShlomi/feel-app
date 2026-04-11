<script>
    import { createEventDispatcher } from 'svelte';
    import { browser } from '$app/environment';
    import { navigating, page } from '$app/stores';
    import { getFilterStyle, isMobile } from '$lib/stores.js'; 
    import { computeCoverBaseSize, computeMaxTranslateFromBase, pctToTranslate, clamp } from '$lib/utils/cropMath.js';
    
    export let id;
    export let src; 
    export let size = 150; 
    export let transform = null;
    export let isSplitPart = false;
    export let hidden = false; 
    export let activeEffectId = 'original';
    /** Incremented by parent after editor save so transforms re-sync while workspace stayed mounted. */
    export let layoutRefreshEpoch = 0;
    
    const dispatch = createEventDispatcher();
    
    let imgElement;
    let isLandscape = true; 
    let isImageLoaded = false;
    let hasLoadedOnce = false;

    /** מצב טעינה מקומי למעבר לעורך (לחיצה על עריכה / על המגנט במובייל) */
    let editNavPending = false;
    let editNavSawKitNavigating = false;

    function beginEditNavigation() {
        if (isSplitPart) return;
        editNavPending = true;
        editNavSawKitNavigating = false;
    }

    $: if (editNavPending && $navigating) editNavSawKitNavigating = true;
    $: if (editNavPending && editNavSawKitNavigating && !$navigating) {
        editNavPending = false;
        editNavSawKitNavigating = false;
    }
    $: if (editNavPending && $page.url.pathname === `/uploader/edit/${id}`) {
        editNavPending = false;
        editNavSawKitNavigating = false;
    }

    // Keep previous image visible until the next src is decoded, to avoid
    // transient blanks on iOS Safari when blob URLs are reassigned mid-scroll.
    let displaySrc = src;
    let srcSwapToken = 0;

    function decodeImageUrl(url) {
        return new Promise((resolve) => {
            if (!browser || !url) return resolve(false);
            try {
                const pre = new Image();
                pre.decoding = 'async';
                pre.onload = async () => {
                    try {
                        if (typeof pre.decode === 'function') await pre.decode();
                    } catch {}
                    resolve(true);
                };
                pre.onerror = () => resolve(false);
                pre.src = url;
            } catch {
                resolve(false);
            }
        });
    }

    async function swapDisplaySrcWhenReady(next) {
        const token = ++srcSwapToken;
        if (!next) {
            displaySrc = next;
            return;
        }
        // First paint: no need to gate; just show it.
        if (!hasLoadedOnce || !displaySrc) {
            displaySrc = next;
            return;
        }
        if (next === displaySrc) return;

        const ok = await decodeImageUrl(next);
        if (token !== srcSwapToken) return;
        if (!ok) {
            // Fall back to immediate swap; better than getting stuck.
            displaySrc = next;
            return;
        }
        displaySrc = next;
    }

    /** Actual CSS width of the tile (mobile grid uses 100% of cell, often ≠ store `size`). */
    let measuredFrame = 0;

    /**
     * @param {HTMLElement} node
     * @param {boolean} active
     */
    function bindFrameMeasure(node, active) {
        let ro;
        let raf = 0;
        function measure() {
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                const w = Math.round(node.clientWidth);
                if (w > 0 && w !== measuredFrame) measuredFrame = w;
            });
        }
        function start() {
            measure();
            if (!browser || typeof ResizeObserver === 'undefined') return;
            ro = new ResizeObserver(measure);
            ro.observe(node);
        }
        function stop() {
            ro?.disconnect();
            ro = undefined;
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
            measuredFrame = 0;
        }
        if (active) start();
        return {
            update(next) {
                stop();
                if (next) start();
            },
            destroy() {
                stop();
            }
        };
    }

    // Legacy editor saved translation relative to FRAME_SIZE=300.
    const LEGACY_FRAME_SIZE = 300;

    $: hasTransform = transform && (
        (typeof transform.xPct === 'number' && transform.xPct !== 0) ||
        (typeof transform.yPct === 'number' && transform.yPct !== 0) ||
        (typeof transform.x === 'number' && transform.x !== 0) ||
        (typeof transform.y === 'number' && transform.y !== 0) ||
        (transform.zoom !== 1)
    );
    $: filterCss = getFilterStyle(activeEffectId);

    // Atomic src swap: only change the <img> src once the next image is decoded.
    $: if (!isSplitPart && browser && src !== displaySrc) {
        swapDisplaySrcWhenReady(src);
    }

    // Measure only on mobile where the grid CSS overrides the tile width (100% of cell).
    // On desktop, using the store `size` avoids a ResizeObserver per tile and keeps uploads snappy.
    $: frameSize = $isMobile && !isSplitPart && measuredFrame > 0 ? measuredFrame : size;

    /** Derived from props + image geometry only (no separate mutable "transform cache"). */
    $: cropForCss = (() => {
        void layoutRefreshEpoch;
        if (isSplitPart) return null;
        const tr = transform;
        const z = tr?.zoom ?? 1;
        if (!imgElement || !isImageLoaded || !frameSize) {
            return { z, tx: 0, ty: 0, bw: frameSize || 0, bh: frameSize || 0 };
        }
        const imgW = imgElement.naturalWidth || 0;
        const imgH = imgElement.naturalHeight || 0;
        if (!imgW || !imgH || !frameSize) {
            return { z, tx: 0, ty: 0, bw: frameSize, bh: frameSize };
        }
        const { baseW: bw, baseH: bh } = computeCoverBaseSize(imgW, imgH, frameSize);
        const { maxX, maxY } = computeMaxTranslateFromBase(bw, bh, frameSize, z);
        let tx = 0;
        let ty = 0;
        if (typeof tr?.xPct === 'number' || typeof tr?.yPct === 'number') {
            const t = pctToTranslate(tr?.xPct, tr?.yPct, maxX, maxY);
            tx = t.x;
            ty = t.y;
        } else {
            const legacyX = typeof tr?.x === 'number' ? tr.x : 0;
            const legacyY = typeof tr?.y === 'number' ? tr.y : 0;
            tx = clamp(legacyX * LEGACY_FRAME_SIZE, -maxX, maxX);
            ty = clamp(legacyY * LEGACY_FRAME_SIZE, -maxY, maxY);
        }
        return { z, tx, ty, bw, bh };
    })();

    $: cssVars = (() => {
        void layoutRefreshEpoch;
        const fw = frameSize || 150;
        if (isSplitPart && transform) {
            return `
        --magnet-size: ${fw}px;
        --zoom: 1;
        --tx: 0px;
        --ty: 0px;
        --base-w: ${fw}px;
        --base-h: ${fw}px;
        --bg-w: ${transform.bgWidth}px;
        --bg-h: ${transform.bgHeight}px;
        --bg-x: ${transform.bgPosX}px;
        --bg-y: ${transform.bgPosY}px;
        --bg-url: url('${src}');
    `;
        }
        const c = cropForCss;
        if (!c) {
            return `
        --magnet-size: ${fw}px;
        --zoom: 1;
        --tx: 0px;
        --ty: 0px;
        --base-w: ${fw}px;
        --base-h: ${fw}px;
        --bg-w: 0px;
        --bg-h: 0px;
        --bg-x: 0px;
        --bg-y: 0px;
        --bg-url: url('${src}');
    `;
        }
        return `
        --magnet-size: ${fw}px;
        --zoom: ${c.z};
        --tx: ${c.tx}px;
        --ty: ${c.ty}px;
        --base-w: ${c.bw}px;
        --base-h: ${c.bh}px;
        --bg-w: 0px;
        --bg-h: 0px;
        --bg-x: 0px;
        --bg-y: 0px;
        --bg-url: url('${src}');
    `;
    })();

    function handleImageLoad() {
        if (!imgElement) return;
        isLandscape = imgElement.naturalWidth >= imgElement.naturalHeight;
        isImageLoaded = true;
        hasLoadedOnce = true;
    }
    
    // --- אירועים ---
    // שיפור לוגיקה למניעת התנגשויות טאץ'/קליק
    function handleInteraction(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        
        // בפסיפס, לחיצה משנה נראות
        if (isSplitPart) { 
            // מניעת הפעלת האירוע פעמיים אם המערכת יורה גם touch וגם click
            if (e.type === 'touchstart') e.preventDefault(); 
            dispatch('toggleVisibility', { id }); 
            return; 
        } 
        
        // עריכת תמונה: הרמה להורה כדי לאפשר UX אחיד (שימור scroll + loader + חסימת לחיצות חוזרות)
        beginEditNavigation();
        dispatch('openEdit', { id });
    }

    function handleEditClick(e) {
        if (e) { e.stopPropagation(); }
        beginEditNavigation();
        dispatch('openEdit', { id });
    }

    
    function handleDeleteClick(e) {
        if (e) { e.stopPropagation(); }
        if (isSplitPart) { dispatch('toggleVisibility', { id }); } else { dispatch('delete', { id }); }
    }
    
    function handleImageError(e) { 
        if (e.target.src !== displaySrc) e.target.src = displaySrc; 
        else e.target.style.opacity = 0;
    }
</script>

<div 
    class="magnet magnet-container" 
    class:split-part={isSplitPart} 
    class:is-hidden={hidden}
    class:desktop-mode={!$isMobile}
    use:bindFrameMeasure={$isMobile && !isSplitPart}
    style="{cssVars}"
    on:click={handleInteraction} 
    role={isSplitPart ? undefined : 'button'}
    aria-label={isSplitPart ? undefined : 'פתח עריכת תמונה'}
>
    <div 
        class="image-wrapper" 
        class:sharp-corners={isSplitPart}
        class:is-portrait={!isLandscape}
        class:has-transform={hasTransform}
        class:is-edit-navigating={editNavPending}
    >
        {#if isSplitPart && transform}
            <div class="split-image" style="{filterCss}"></div>
        {:else}
            <img 
                src={displaySrc} 
                bind:this={imgElement}
                on:load={handleImageLoad}
                alt="" 
                draggable="false"
                loading="eager"
                decoding="async"
                fetchpriority="auto"
                class="magnet-image"
                class:is-landscape={isLandscape}
                class:is-portrait={!isLandscape}
                class:loaded={hasLoadedOnce}
                style="{filterCss}" 
                on:error={handleImageError} 
            />
        {/if}

        {#if editNavPending && !isSplitPart}
            <div class="edit-nav-overlay" aria-hidden="true">
                <div class="edit-nav-spinner"></div>
            </div>
        {/if}

        <div class="overlay" class:always-visible={$isMobile} class:force-visible={hidden}>
            {#if !$isMobile && !isSplitPart && !hidden}
                <button class="control-btn edit-btn" aria-label="ערוך תמונה" on:click={handleEditClick} on:mousedown|stopPropagation>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                </button>
            {/if}
            {#if !hidden}
                {#if isSplitPart || (!$isMobile && !isSplitPart)}
                    <button class="control-btn delete-btn" aria-label="מחק תמונה" on:click={handleDeleteClick} on:mousedown|stopPropagation on:touchstart|stopPropagation>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                {/if}
            {/if}
            {#if isSplitPart && hidden}
                <div class="restore-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    .magnet { width: 100%; height: 100%; position: relative; touch-action: none; user-select: none; cursor: pointer; padding: 0; box-sizing: border-box; }
    .magnet.is-hidden .image-wrapper { opacity: 0.3; filter: grayscale(100%); border: 1px dashed #ccc; }
    
    .image-wrapper { 
        width: 100%; height: 100%; position: relative; border-radius: 12px; overflow: hidden; background: #fff; 
        box-shadow: 0 2px 8px rgba(0,0,0,0.08); transition: box-shadow 0.3s, opacity 0.2s; z-index: 1; pointer-events: none; 
        display: flex; justify-content: center; align-items: center; 
    }
    .image-wrapper.is-edit-navigating .magnet-image { opacity: 0.72; filter: brightness(0.96); }

    .edit-nav-overlay {
        position: absolute;
        inset: 0;
        z-index: 15;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        background: rgba(255, 255, 255, 0.22);
    }
    .edit-nav-spinner {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 2.5px solid rgba(63, 82, 79, 0.22);
        border-top-color: var(--color-pink);
        animation: magnetEditSpin 0.65s linear infinite;
    }
    @keyframes magnetEditSpin {
        to { transform: rotate(360deg); }
    }
    
    .image-wrapper.is-portrait:not(.has-transform) { align-items: flex-start; }
    
    .magnet.split-part .image-wrapper { background: transparent; }
    .image-wrapper.sharp-corners { border-radius: 0 !important; box-shadow: none; }
    
    .magnet-image { 
        display: block;
        position: absolute;
        left: 50%;
        top: 50%;
        width: var(--base-w);
        height: var(--base-h);
        transform-origin: center center;
        will-change: transform;
        /* Mobile-first stability: avoid "brightness fade" perception on load.
           We already gate blob-url swaps via decode, so a CSS fade is unnecessary and can flicker on iOS. */
        opacity: 1;
        transform: translate(-50%, -50%) translate(var(--tx), var(--ty)) scale(var(--zoom));
    }
    
    .magnet-image.is-landscape { width: var(--base-w); height: var(--base-h); }
    .magnet-image.is-portrait { width: var(--base-w); height: var(--base-h); }
    
    @media (hover: hover) {
        .magnet.desktop-mode:hover .image-wrapper { box-shadow: 0 12px 24px rgba(0,0,0,0.15); }
        .magnet.desktop-mode:hover .overlay { opacity: 1; }
    }
    
    .split-image { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-image: var(--bg-url); background-size: var(--bg-w) var(--bg-h); background-position: var(--bg-x) var(--bg-y); background-repeat: no-repeat; }
    .overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(2px); opacity: 0; transition: opacity 0.2s; z-index: 20; pointer-events: none; }
    .overlay.force-visible { opacity: 1; background: rgba(255,255,255,0.2); pointer-events: auto; }
    .magnet:hover .overlay { pointer-events: auto; }
    
    .control-btn { position: absolute; top: 8px; width: 32px; height: 32px; border-radius: 50%; background: white; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.2); opacity: 0; transform: scale(0.8); transition: all 0.2s; padding: 0; pointer-events: auto; z-index: 30; }
    .magnet:hover .control-btn { opacity: 1; transform: scale(1); }
    .control-btn:hover { transform: scale(1.1); background: #f5f5f7; }
    .control-btn svg { width: 18px; height: 18px; display: block; color: inherit; }
    .edit-btn { left: 8px; color: #333; }
    .delete-btn { right: 8px; color: #e53935; }
    .restore-icon { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #333; width: 32px; height: 32px; opacity: 0.7; pointer-events: none; }
</style>