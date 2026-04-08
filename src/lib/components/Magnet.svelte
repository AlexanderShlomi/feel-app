<script>
    import { createEventDispatcher } from 'svelte';
    import { browser } from '$app/environment';
    import { getFilterStyle, isMobile } from '$lib/stores.js'; 
    import { computeCoverBaseSize, computeMaxTranslateFromBase, pctToTranslate, clamp } from '$lib/utils/cropMath.js';
    
    export let id;
    export let src; 
    export let size = 150; 
    export let transform = null;
    export let isSplitPart = false;
    export let hidden = false; 
    export let activeEffectId = 'original';
    
    const dispatch = createEventDispatcher();
    
    let imgElement;
    let isLandscape = true; 
    let isImageLoaded = false;

    /** Actual CSS width of the tile (mobile grid uses 100% of cell, often ≠ store `size`). */
    let measuredFrame = 0;

    /**
     * @param {HTMLElement} node
     * @param {boolean} active
     */
    function bindFrameMeasure(node, active) {
        let ro;
        function measure() {
            const w = Math.round(node.clientWidth);
            if (w > 0) measuredFrame = w;
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
    let translateX = 0;
    let translateY = 0;
    let zoom = 1;
    let baseW = 0;
    let baseH = 0;
    
    $: hasTransform = transform && (
        (typeof transform.xPct === 'number' && transform.xPct !== 0) ||
        (typeof transform.yPct === 'number' && transform.yPct !== 0) ||
        (typeof transform.x === 'number' && transform.x !== 0) ||
        (typeof transform.y === 'number' && transform.y !== 0) ||
        (transform.zoom !== 1)
    );
    $: filterCss = getFilterStyle(activeEffectId);

    $: frameSize = !isSplitPart && measuredFrame > 0 ? measuredFrame : size;

    function recomputeTransform() {
        // Only for non-mosaic magnets, and only once we know image dimensions.
        if (isSplitPart) return;
        const z = transform?.zoom || 1;
        zoom = z;

        if (!imgElement || !isImageLoaded) {
            translateX = 0;
            translateY = 0;
            return;
        }

        const imgW = imgElement.naturalWidth || 0;
        const imgH = imgElement.naturalHeight || 0;
        if (!imgW || !imgH || !frameSize) {
            translateX = 0;
            translateY = 0;
            return;
        }
        const { maxX, maxY } = computeMaxTranslateFromBase(baseW, baseH, frameSize, z);

        // v2 (preferred): pct of allowed overflow range [-1..1]
        if (typeof transform?.xPct === 'number' || typeof transform?.yPct === 'number') {
            const t = pctToTranslate(transform?.xPct, transform?.yPct, maxX, maxY);
            translateX = t.x;
            translateY = t.y;
            return;
        }

        // Legacy v1: stored relative to FRAME_SIZE=300, interpret as px in that space then clamp to current bounds.
        const legacyX = typeof transform?.x === 'number' ? transform.x : 0;
        const legacyY = typeof transform?.y === 'number' ? transform.y : 0;
        translateX = clamp(legacyX * LEGACY_FRAME_SIZE, -maxX, maxX);
        translateY = clamp(legacyY * LEGACY_FRAME_SIZE, -maxY, maxY);
    }

    function recomputeCoverBaseSize() {
        if (isSplitPart) return;
        if (!imgElement || !isImageLoaded) return;
        const imgW = imgElement.naturalWidth || 0;
        const imgH = imgElement.naturalHeight || 0;
        if (!imgW || !imgH || !frameSize) return;
        const { baseW: bw, baseH: bh } = computeCoverBaseSize(imgW, imgH, frameSize);
        baseW = bw;
        baseH = bh;
    }
    
    $: cssVars = `
        --magnet-size: ${frameSize}px;
        --zoom: ${(!isSplitPart && transform) ? (transform.zoom || 1) : 1};
        --tx: ${(!isSplitPart && transform) ? translateX : 0}px;
        --ty: ${(!isSplitPart && transform) ? translateY : 0}px;
        --base-w: ${(!isSplitPart && baseW) ? baseW : frameSize}px;
        --base-h: ${(!isSplitPart && baseH) ? baseH : frameSize}px;
        --bg-w: ${(isSplitPart && transform) ? transform.bgWidth : 0}px;
        --bg-h: ${(isSplitPart && transform) ? transform.bgHeight : 0}px;
        --bg-x: ${(isSplitPart && transform) ? transform.bgPosX : 0}px;
        --bg-y: ${(isSplitPart && transform) ? transform.bgPosY : 0}px;
        --bg-url: url('${src}');
    `;

    function handleImageLoad() {
        if (!imgElement) return;
        isLandscape = imgElement.naturalWidth >= imgElement.naturalHeight;
        isImageLoaded = true;
        recomputeCoverBaseSize();
        recomputeTransform();
    }

    // Recompute when transform / frame size changes after image load.
    $: if (!isSplitPart && isImageLoaded && frameSize && transform) {
        recomputeCoverBaseSize();
        recomputeTransform();
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
        dispatch('openEdit', { id });
    }

    function handleEditClick(e) {
        if (e) { e.stopPropagation(); }
        dispatch('openEdit', { id });
    }

    
    function handleDeleteClick(e) {
        if (e) { e.stopPropagation(); }
        if (isSplitPart) { dispatch('toggleVisibility', { id }); } else { dispatch('delete', { id }); }
    }
    
    function handleImageError(e) { 
        if (e.target.src !== src) e.target.src = src; 
        else e.target.style.opacity = 0;
    }
</script>

<div 
    class="magnet magnet-container" 
    class:split-part={isSplitPart} 
    class:is-hidden={hidden}
    class:desktop-mode={!$isMobile}
    use:bindFrameMeasure={!isSplitPart}
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
    >
        {#if isSplitPart && transform}
            <div class="split-image" style="{filterCss}"></div>
        {:else}
            <img 
                src={src} 
                bind:this={imgElement}
                on:load={handleImageLoad}
                alt="" 
                draggable="false"
                loading={$isMobile ? 'eager' : 'lazy'}
                decoding="async"
                fetchpriority={$isMobile ? 'low' : undefined}
                class="magnet-image"
                class:is-landscape={isLandscape}
                class:is-portrait={!isLandscape}
                class:loaded={isImageLoaded}
                style="{filterCss}" 
                on:error={handleImageError} 
            />
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
        opacity: 0;
        transition: opacity 0.2s;
        transform: translate(-50%, -50%) translate(var(--tx), var(--ty)) scale(var(--zoom));
    }
    
    .magnet-image.loaded { opacity: 1; }
    .magnet-image.is-landscape { width: var(--base-w); height: var(--base-h); }
    .magnet-image.is-portrait { width: var(--base-w); height: var(--base-h); }
    
    @media (hover: hover) {
        .magnet.desktop-mode:hover .image-wrapper { box-shadow: 0 12px 24px rgba(0,0,0,0.15); }
        .magnet.desktop-mode:hover .overlay { opacity: 1; }
    }
    
    .split-image { position: absolute; top: 0; left: 0; width: 100%; height: 100%; image-rendering: -webkit-optimize-contrast; background-image: var(--bg-url); background-size: var(--bg-w) var(--bg-h); background-position: var(--bg-x) var(--bg-y); background-repeat: no-repeat; }
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