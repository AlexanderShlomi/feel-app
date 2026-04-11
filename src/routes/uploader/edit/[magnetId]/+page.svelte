<script>
    import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { magnets, updateMagnetTransform, updateMagnetActiveEffect, getFilterStyle, getCssFilter, beginUserInteraction, endUserInteraction, isMobile } from '$lib/stores.js';
    import { computeCoverBaseSize, computeMaxTranslateFromBase, pctToTranslate, translateToPct, clamp } from '$lib/utils/cropMath.js';
    import FloatingPanel from '$lib/components/FloatingPanel.svelte';
    import EffectsRow from '$lib/components/EffectsRow.svelte';

    const FRAME_SIZE = 300; 

    /** Must be reactive — `const` from `$page` would not update on client navigations. */
    $: magnetId = $page.params.magnetId;
    let magnet;
    $: magnet = $magnets.find(m => m.id === magnetId);

    const effectsList = [
        { id: 'original', name: 'מקורי' },
        { id: 'silver', name: 'כסף' },
        { id: 'noir', name: 'נואר' },
        { id: 'vivid', name: 'עז' },
        { id: 'dramatic', name: 'דרמטי' }
    ].map(e => ({ ...e, css: getCssFilter(e.id) }));

    let bgTranslateX = 0;
    let bgTranslateY = 0;
    let bgScale = 1;
    let minScaleLimit = 0.1;
    let zoomMultiplier = 1; // 1..3, slider source-of-truth (stable even when minScaleLimit changes)

    let isDragging = false;
    let isInteracting = false; 
    let dragStartX = 0;
    let dragStartY = 0;
    let activePointerId = null;
    let pendingDeltaX = 0;
    let pendingDeltaY = 0;
    let dragRafId = 0;
    let zoomRafId = 0;
    let pendingZoomMultiplier = null;
    let hasInitializedImage = false;
    
    let bgImageEl; 
    let activePanel = null;

    let isImageDecoded = false;
    let renderSrc = null; // never show a blank frame: swap only after decode
    let lastResolvedSrc = null;
    let preloadToken = 0;
    /** Set in decode done(); avoids reading `renderSrc` in the preload reactive (extra re-runs). */
    let committedFirstFrame = false;

    let previewSrc = null;
    let previewSrcToRevoke = null;

    // Use original image geometry (not preview) for crop math to match the grid.
    let baseNaturalW = 0;
    let baseNaturalH = 0;
    let baseGeomToken = 0;

    // Cover base size (the same geometry the grid uses).
    let coverBaseW = 0;
    let coverBaseH = 0;

    $: currentEffectId = magnet?.activeEffectId || 'original';
    $: displaySrc = magnet?.originalSrc || magnet?.src;
    $: resolvedEffectSrc = previewSrc || displaySrc;
    $: resolvedFilterCss = getFilterStyle(currentEffectId);
    $: isLoadingEffect = false;

    let prevMagnetRouteId = null;
    $: if (magnetId !== prevMagnetRouteId) {
        prevMagnetRouteId = magnetId;
        committedFirstFrame = false;
        renderSrc = null;
        lastResolvedSrc = null;
        preloadToken++;
        previewSrc = null;
        if (previewSrcToRevoke) {
            try { URL.revokeObjectURL(previewSrcToRevoke); } catch {}
            previewSrcToRevoke = null;
        }
    }

    $: if (resolvedEffectSrc && resolvedEffectSrc !== lastResolvedSrc) {
        lastResolvedSrc = resolvedEffectSrc;
        // Only blank the stage before the first committed decode. When swapping to the desktop
        // preview blob, keep the current frame visible (no shimmer). Use `committedFirstFrame`,
        // not `renderSrc`, so this reactive does not re-run on every `renderSrc` update.
        if (!committedFirstFrame) isImageDecoded = false;
        const token = ++preloadToken;
        const img = new Image();
        img.decoding = 'async';
        img.src = resolvedEffectSrc;
        const done = () => {
            if (token !== preloadToken) return;
            renderSrc = resolvedEffectSrc;
            isImageDecoded = true;
            committedFirstFrame = true;
        };
        // decode() avoids blank frames on iOS when swapping large images.
        if (img.decode) {
            img.decode().then(done).catch(() => {
                // Fallback to onload in browsers where decode fails for some sources.
                img.onload = done;
                img.onerror = done;
            });
        } else {
            img.onload = done;
            img.onerror = done;
        }
    }

    onMount(() => {
        if (!magnet) { goto('/uploader'); return; }

        // Load original geometry once; iOS can differ between preview sizing and original sizing.
        // Using original naturalWidth/Height keeps xPct/yPct consistent with grid rendering.
        (async () => {
            const token = ++baseGeomToken;
            try {
                const src = displaySrc;
                if (!src) return;
                const img = new Image();
                img.decoding = 'async';
                img.src = src;
                if (img.decode) await img.decode().catch(() => {});
                if (token !== baseGeomToken) return;
                baseNaturalW = img.naturalWidth || 0;
                baseNaturalH = img.naturalHeight || 0;
            } catch {
                // best-effort; we'll fallback to bgImageEl dimensions
            }
        })();
        
        // Desktop: downscaled blob so pan/zoom stays light. Mobile skips this — a second
        // fetch+canvas pass duplicated work and stretched time-to-interactive on large photos.
        if (!get(isMobile)) {
            createPreview(displaySrc).then((url) => {
                if (!url) return;
                previewSrcToRevoke = url;
                previewSrc = url;
            });
        }
    });

    onDestroy(() => {
        if (dragRafId) cancelAnimationFrame(dragRafId);
        if (zoomRafId) cancelAnimationFrame(zoomRafId);
        if (previewSrcToRevoke && previewSrcToRevoke.startsWith('blob:')) {
            try { URL.revokeObjectURL(previewSrcToRevoke); } catch {}
        }
    });

    async function createPreview(src) {
        try {
            if (!src) return null;
            const resp = await fetch(src);
            const blob = await resp.blob();

            // IMPORTANT:
            // Use <img> decoding (not createImageBitmap) for preview generation because mobile camera photos
            // often rely on EXIF orientation. <img> rendering is the source-of-truth for the grid too,
            // while createImageBitmap may ignore EXIF on some browsers even with imageOrientation hints.
            const objUrl = URL.createObjectURL(blob);
            const img = await (async () => {
                const el = new Image();
                el.decoding = 'async';
                el.src = objUrl;
                // decode() is more reliable than onload for avoiding flashes, but isn't universal.
                if (el.decode) {
                    await el.decode().catch(() => {});
                } else {
                    await new Promise((res, rej) => { el.onload = res; el.onerror = rej; });
                }
                return el;
            })();

            const w = img.width || img.naturalWidth;
            const h = img.height || img.naturalHeight;
            if (!w || !h) return null;

            const MAX_DIM = 1600;
            const scale = Math.min(1, MAX_DIM / Math.max(w, h));
            const outW = Math.max(1, Math.round(w * scale));
            const outH = Math.max(1, Math.round(h * scale));

            const canvas = document.createElement('canvas');
            canvas.width = outW;
            canvas.height = outH;
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.drawImage(img, 0, 0, outW, outH);

            // Release the temporary object URL promptly (image is already in memory).
            try { URL.revokeObjectURL(objUrl); } catch {}

            const outBlob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
            if (!outBlob) return null;
            return URL.createObjectURL(outBlob);
        } catch {
            return null;
        }
    }

    // --- לוגיקה מרכזית: חישוב גבולות ומיקום ---

    function onBgImageLoad() {
        if (!bgImageEl) return;

        // Prefer original dimensions for math so saved crop matches grid rendering.
        const naturalW = baseNaturalW || bgImageEl.naturalWidth;
        const naturalH = baseNaturalH || bgImageEl.naturalHeight;

        const { baseW, baseH, minScale: nextMinScale } = computeCoverBaseSize(naturalW, naturalH, FRAME_SIZE);
        coverBaseW = baseW;
        coverBaseH = baseH;

        // חשוב: החלפת src בעת שינוי אפקט גורמת ל-onload מחדש.
        // אסור לאתחל מחדש transform — זה נראה כמו "קופץ חזרה לגודל המקורי".
        if (!hasInitializedImage) {
            minScaleLimit = nextMinScale;

            if (magnet.transform && magnet.transform.zoom) {
                // שחזור מלא של מצב עריכה קיים (תמיכה ב-v2 + תאימות לאחור)
                zoomMultiplier = magnet.transform.zoom;
                bgScale = zoomMultiplier;

                const { maxX, maxY } = computeMaxTranslateFromBase(baseW, baseH, FRAME_SIZE, zoomMultiplier);

                if (typeof magnet.transform.xPct === 'number' || typeof magnet.transform.yPct === 'number') {
                    const t = pctToTranslate(magnet.transform.xPct, magnet.transform.yPct, maxX, maxY);
                    bgTranslateX = t.x;
                    bgTranslateY = t.y;
                } else {
                    // Legacy: saved relative to FRAME_SIZE=300
                    bgTranslateX = (magnet.transform.x || 0) * FRAME_SIZE;
                    bgTranslateY = (magnet.transform.y || 0) * FRAME_SIZE;
                }
            } else {
                // אתחול ראשוני - משתמש באותה לוגיקה של כפתור האיפוס
                applyDefaultPositioning(naturalW, naturalH);
                zoomMultiplier = 1;
                bgScale = 1;
            }

            hasInitializedImage = true;
        } else {
            minScaleLimit = nextMinScale;
            bgScale = zoomMultiplier;
        }
        
        clampPosition();
    }

    // פונקציה מרכזית לחישוב מיקום ה-Default (Top Align)
    function applyDefaultPositioning(w, h) {
        // Default: cover + top-align.
        // Keep math identical to grid by working in cover-base geometry.
        const { baseW, baseH } = computeCoverBaseSize(w, h, FRAME_SIZE);
        coverBaseW = baseW;
        coverBaseH = baseH;

        bgTranslateX = 0;
        const { maxY } = computeMaxTranslateFromBase(baseW, baseH, FRAME_SIZE, zoomMultiplier);
        bgTranslateY = maxY;
    }

    function clampPosition() {
        if (!bgImageEl) return;

        const naturalW = baseNaturalW || bgImageEl.naturalWidth;
        const naturalH = baseNaturalH || bgImageEl.naturalHeight;

        const { baseW, baseH } = computeCoverBaseSize(naturalW, naturalH, FRAME_SIZE);
        coverBaseW = baseW;
        coverBaseH = baseH;
        const { maxX, maxY } = computeMaxTranslateFromBase(baseW, baseH, FRAME_SIZE, zoomMultiplier);

        if (bgTranslateX > maxX) bgTranslateX = maxX;
        if (bgTranslateX < -maxX) bgTranslateX = -maxX;
        
        if (bgTranslateY > maxY) bgTranslateY = maxY;
        if (bgTranslateY < -maxY) bgTranslateY = -maxY;
    }

    // --- אירועי גרירה ואינטראקציה ---

    function startInteraction() {
        if (!isInteracting) beginUserInteraction();
        isInteracting = true;
    }
    function endInteraction() {
        isDragging = false;
        if (isInteracting) endUserInteraction();
        isInteracting = false;
    }

    function startDrag(e) {
        // Pointer events unify mouse/touch and avoid global touchmove listeners.
        if (e.cancelable) e.preventDefault();
        if (activePointerId !== null) return;

        activePointerId = e.pointerId ?? null;
        isDragging = true;
        startInteraction();

        dragStartX = e.clientX;
        dragStartY = e.clientY;

        if (e.currentTarget?.setPointerCapture && activePointerId !== null) {
            try { e.currentTarget.setPointerCapture(activePointerId); } catch {}
        }
    }

    function flushPendingDrag() {
        dragRafId = 0;
        if (!isDragging) return;

        bgTranslateX += pendingDeltaX;
        bgTranslateY += pendingDeltaY;
        pendingDeltaX = 0;
        pendingDeltaY = 0;
        clampPosition();
    }

    function onDrag(e) {
        if (!isDragging) return;
        if (activePointerId !== null && e.pointerId !== activePointerId) return;
        if (e.cancelable) e.preventDefault();

        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        pendingDeltaX += deltaX;
        pendingDeltaY += deltaY;

        if (!dragRafId) dragRafId = requestAnimationFrame(flushPendingDrag);
    }

    function handleGlobalEnd(e) {
        if (activePointerId !== null && e?.pointerId !== activePointerId) return;
        activePointerId = null;
        pendingDeltaX = 0;
        pendingDeltaY = 0;
        if (dragRafId) {
            cancelAnimationFrame(dragRafId);
            dragRafId = 0;
        }
        if (isInteracting) endInteraction();
    }

    function handleZoomInput(e) {
        // Throttle updates to 60fps to keep slider responsive on mobile.
        pendingZoomMultiplier = parseFloat(e.target.value);
        startInteraction();
        if (!zoomRafId) {
            zoomRafId = requestAnimationFrame(() => {
                zoomRafId = 0;
                if (pendingZoomMultiplier === null) return;
                zoomMultiplier = pendingZoomMultiplier;
                bgScale = zoomMultiplier;
                pendingZoomMultiplier = null;
                clampPosition();
            });
        }
    }
    function endZoomInteraction() {
        if (!isInteracting) return;
        handleGlobalEnd({ pointerId: activePointerId });
    }

    // --- שמירה ואיפוס ---

    function resetTransform() {
        if (!bgImageEl) return;
        // חישוב מחדש של המינימום
        const naturalW = baseNaturalW || bgImageEl.naturalWidth;
        const naturalH = baseNaturalH || bgImageEl.naturalHeight;
        const { minScale } = computeCoverBaseSize(naturalW, naturalH, FRAME_SIZE);
        minScaleLimit = minScale;

        zoomMultiplier = 1;
        bgScale = 1;

        // שימוש בלוגיקה המרכזית
        applyDefaultPositioning(naturalW, naturalH);
        
        clampPosition();
        applyEffect('original');
    }

    function saveAndClose() {
        // שמירה מדויקת (v2): xPct/yPct הם יחס מה-overscroll המותר [-1..1] עבור אותו zoom.
        // זה מאפשר רינדור עקבי בגריד/בהדפסה בכל גודל tile.
        const naturalW = baseNaturalW || (bgImageEl?.naturalWidth || 0);
        const naturalH = baseNaturalH || (bgImageEl?.naturalHeight || 0);
        const { baseW, baseH } = computeCoverBaseSize(naturalW, naturalH, FRAME_SIZE);
        const { maxX, maxY } = computeMaxTranslateFromBase(baseW, baseH, FRAME_SIZE, zoomMultiplier);
        const { xPct, yPct } = translateToPct(bgTranslateX, bgTranslateY, maxX, maxY);

        updateMagnetTransform(magnetId, {
            zoom: zoomMultiplier,
            xPct: clamp(xPct, -1, 1),
            yPct: clamp(yPct, -1, 1)
        });
        goto('/uploader', { noScroll: true });
    }

    function applyEffect(effectId) {
        // עדכון האפקט הנוכחי במגנט עצמו (לוגיקה ויזואלית תמיד תרוץ)
        updateMagnetActiveEffect(magnetId, effectId);
    }
    
    function deleteMagnet() {
        if (confirm('למחוק את התמונה?')) {
            magnets.update(list => list.filter(m => m.id !== magnetId));
            goto('/uploader', { noScroll: true });
        }
    }
</script>

<div class="brand-loader-bar" style="display: {isLoadingEffect ? 'block' : 'none'};">
    <div class="loader-progress"></div>
</div>

{#if magnet}
<div class="magnet-edit-layout">
    <div class="editor-page" class:is-interacting={isInteracting}>
        <div class="editor-stage">
            {#if !isImageDecoded}
                <div class="image-placeholder" aria-hidden="true">
                    <div class="placeholder-shimmer"></div>
                </div>
            {/if}
            <div class="image-layer">
                <div
                    class="movable-content"
                    style="transform: translate(-50%, -50%) translate({bgTranslateX}px, {bgTranslateY}px) scale({zoomMultiplier});"
                >
                    <img
                        src={renderSrc || resolvedEffectSrc}
                        bind:this={bgImageEl}
                        on:load={(e) => { isImageDecoded = true; onBgImageLoad(e); }}
                        style="{resolvedFilterCss}; width: {coverBaseW ? `${coverBaseW}px` : 'auto'}; height: {coverBaseH ? `${coverBaseH}px` : 'auto'};"
                        loading="eager"
                        decoding="async"
                        fetchpriority="high"
                        alt="editing source"
                    />
                </div>
            </div>

            <div
                class="mask-layer"
                on:pointerdown={startDrag}
                on:pointermove={onDrag}
                on:pointerup={handleGlobalEnd}
                on:pointercancel={handleGlobalEnd}
            >
                <div class="mask-hole" style="width: {FRAME_SIZE}px; height: {FRAME_SIZE}px;"></div>
            </div>

            {#if isLoadingEffect}
                <div class="center-loader"><div class="loader-spinner"></div></div>
            {/if}
        </div>

        <div
            class="zoom-controls"
            on:pointerdown={startInteraction}
        >
            <div class="slider-wrapper">
                <span class="icon" aria-hidden="true">-</span>
                <input
                    type="range"
                    min="1"
                    max="3"
                    step="0.01"
                    value={zoomMultiplier}
                    on:input={handleZoomInput}
                    on:change={endZoomInteraction}
                    aria-label="זום"
                    aria-describedby="zoom-hint"
                >
                <span class="icon" aria-hidden="true">+</span>
            </div>
            <span id="zoom-hint" class="hint">הזז את התמונה באצבע ובחר זום בסליידר</span>
        </div>
    </div>

    <footer id="bottom-toolbar-edit" class="glass-dock">
    <button class="dock-btn-text" on:click={resetTransform}>אפס</button>
    <button class="dock-btn-text" on:click={() => activePanel = 'effects'}>אפקטים</button>
    <div class="dock-divider"></div>
    <button class="dock-btn-circle danger" aria-label="מחק תמונה" on:click={deleteMagnet}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
    <button class="dock-btn-circle primary" aria-label="שמור וסגור" on:click={saveAndClose}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"></polyline></svg></button>
</footer>

<FloatingPanel title="בחר אפקט" isOpen={activePanel === 'effects'} on:close={() => activePanel = null}>
    <EffectsRow
        effects={effectsList}
        activeId={currentEffectId}
        onSelect={applyEffect}
        size="sm"
    />
</FloatingPanel>
</div>
{/if}

<style>
    /* גובה מלא מתחת ל-header; ריווח תחתון ל-dock קבוע + iOS safe-area / vv-chrome */
    .magnet-edit-layout {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        width: 100%;
        box-sizing: border-box;
        /* גובה אזור התוכן מתחת ל-header הקבוע */
        min-height: calc(100vh - 70px);
        min-height: calc(100dvh - 70px);
        padding-bottom: max(var(--dock-pad, 0px), calc(96px + env(safe-area-inset-bottom, 0px) + var(--vv-bottom-chrome, 0px)));
    }

    .editor-page {
        position: relative;
        width: 100%;
        flex: 1;
        min-height: 0;
        background-color: var(--color-canvas-bg);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: stretch;
    }

    .editor-stage {
        position: relative;
        flex: 1;
        min-height: 140px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .image-placeholder {
        position: absolute;
        inset: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-canvas-bg);
    }

    .placeholder-shimmer {
        width: min(92vw, 340px);
        height: min(92vw, 340px);
        max-width: 340px;
        max-height: 340px;
        border-radius: 18px;
        background: linear-gradient(
            90deg,
            rgba(0, 0, 0, 0.04),
            rgba(0, 0, 0, 0.09),
            rgba(0, 0, 0, 0.04)
        );
        background-size: 200% 100%;
        animation: brandLoading 1.2s infinite linear;
        border: 1px solid rgba(0, 0, 0, 0.06);
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.06);
    }

    .image-layer {
        position: absolute;
        inset: 0;
        display: flex;
        justify-content: center;
        align-items: center;
        overflow: visible;
        z-index: 1;
    }

    .movable-content {
        position: absolute;
        left: 50%;
        top: 50%;
        transform-origin: center center;
        will-change: transform;
        display: block;
    }

    .movable-content img {
        max-width: none; max-height: none;
        display: block; user-select: none; pointer-events: none;
    }

    .mask-layer {
        position: absolute;
        inset: 0;
        z-index: 10;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: grab;
        touch-action: none;
    }
    .mask-layer:active { cursor: grabbing; }

    .mask-hole {
        /* 🔥 שינוי קריטי: צל חצי שקוף כדי לראות את הקונטקסט */
        box-shadow: 0 0 0 9999px rgba(242, 240, 236, 0.85); 
        border: 1px solid rgba(0, 0, 0, 0.1);
        background: transparent; 
        pointer-events: none;
        transition: box-shadow 0.3s ease-in-out;
    }
    
    /* בעת אינטראקציה, מכהים מעט את הרקע כדי להבליט את אזור העריכה */
    .editor-page.is-interacting .mask-hole {
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
    }
    
    /* מתחת לתמונה בזרימה (לא absolute) — ב-iPhone לא נכנס על אזור החיתוך */
    .zoom-controls {
        position: relative;
        flex-shrink: 0;
        z-index: 25;
        width: 100%;
        max-width: 360px;
        margin: 0 auto;
        box-sizing: border-box;
        padding: 10px 20px 14px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        transition: opacity 0.3s;
        opacity: 0.85;
        background: transparent;
        border-top: none;
        box-shadow: none;
        touch-action: manipulation;
    }
    .zoom-controls:hover,
    .editor-page.is-interacting .zoom-controls {
        opacity: 1;
    }
    .slider-wrapper {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        direction: ltr; /* stable -/+ placement on RTL pages */
    }
    .icon {
        font-weight: 800;
        color: #666;
        font-size: 18px;
        width: 18px;
        text-align: center;
        user-select: none;
    }
    .zoom-controls input {
        width: 100%;
        height: 6px;
        background: rgba(0, 0, 0, 0.12);
        border-radius: 999px;
        -webkit-appearance: none;
        appearance: none;
        outline: none;
        -webkit-tap-highlight-color: transparent;
        direction: ltr;
    }
    .zoom-controls input::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: var(--color-pink);
        border: 2px solid #fff;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    }
    .zoom-controls input::-moz-range-thumb {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: var(--color-pink);
        border: 2px solid #fff;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    }
    .hint {
        color: var(--color-medium-blue-gray);
        font-size: 13px;
        font-weight: 600;
        text-align: center;
        line-height: 1.35;
        padding: 0 8px;
    }
    .brand-loader-bar { position: fixed; top: 0; left: 0; width: 100%; height: 6px; z-index: 99999; }
    .loader-progress { width: 100%; height: 100%; background: linear-gradient(90deg, var(--color-pink), var(--color-gold), var(--color-pink)); background-size: 200% 100%; animation: brandLoading 1.5s infinite linear; }
    .center-loader { position: absolute; z-index: 30; }
    .glass-dock {
        position: fixed;
        bottom: calc(12px + env(safe-area-inset-bottom, 0px) + var(--vv-bottom-chrome, 0px));
        left: 50%;
        transform: translateX(-50%);
        z-index: 1000;
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        justify-content: center;
        gap: 10px 12px;
        padding: 10px 16px;
        border-radius: 50px;
        width: max-content;
        max-width: calc(100vw - 16px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px));
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        transition: opacity 0.3s;
    }
    .glass-dock::-webkit-scrollbar { display: none; }
    .glass-dock .dock-btn-text { flex-shrink: 0; }
    .dock-btn-text { background: none; border: none; font-weight: 700; color: #333; cursor: pointer; }
    .dock-divider { width: 1px; height: 20px; background: #ccc; }
    .dock-btn-circle { width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; }
    .dock-btn-circle.primary { background: var(--color-pink); color: white; }
    .dock-btn-circle.danger { background: #eee; color: #d32f2f; }
</style>