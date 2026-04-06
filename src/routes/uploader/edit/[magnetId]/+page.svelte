<script>
    import { onMount, onDestroy } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { magnets, updateMagnetProcessedSrc, updateMagnetTransform, updateMagnetActiveEffect, getFilterStyle } from '$lib/stores.js';
    import FloatingPanel from '$lib/components/FloatingPanel.svelte';

    const FRAME_SIZE = 300; 

    const magnetId = $page.params.magnetId;
    let magnet;
    $: magnet = $magnets.find(m => m.id === magnetId);

    const effectsList = [
        { id: 'original', name: 'מקורי', filter: 'none' },
        { id: 'silver', name: 'כסף', filter: 'url(#filter-silver)' },
        { id: 'noir', name: 'נואר', filter: 'url(#filter-noir)' },
        { id: 'vivid', name: 'עז', filter: 'url(#filter-vivid)' },
        { id: 'dramatic', name: 'דרמטי', filter: 'url(#filter-dramatic)' }
    ];

    let bgTranslateX = 0;
    let bgTranslateY = 0;
    let bgScale = 1;
    let minScaleLimit = 0.1;

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
    
    let bgImageEl; 
    let effectsWorker;
    let activePanel = null;

    $: currentEffectId = magnet?.activeEffectId || 'original';
    $: displaySrc = magnet?.originalSrc || magnet?.src; 
    $: activeFilterCss = getFilterStyle(currentEffectId);
    $: processedSrc = magnet?.processed?.[currentEffectId];
    $: isLoadingEffect = processedSrc === 'processing';

    onMount(() => {
        if (!magnet) { goto('/uploader'); return; }
        
        effectsWorker = new Worker('/effects.worker.js');
        effectsWorker.onmessage = (event) => {
            const { status, magnetId: processedMagnetId, effectId, blob } = event.data;
            if (status === 'success' && processedMagnetId === magnetId) {
                const newSrc = URL.createObjectURL(blob);
                updateMagnetProcessedSrc(magnetId, effectId, newSrc);
            }
        };
    });

    onDestroy(() => {
        if (effectsWorker) effectsWorker.terminate();
        if (dragRafId) cancelAnimationFrame(dragRafId);
        if (zoomRafId) cancelAnimationFrame(zoomRafId);
    });

    // --- לוגיקה מרכזית: חישוב גבולות ומיקום ---

    function onBgImageLoad() {
        if (!bgImageEl) return;
        
        const naturalW = bgImageEl.naturalWidth;
        const naturalH = bgImageEl.naturalHeight;

        // חישוב יחס זום כדי לכסות את המסגרת
        const scaleX = FRAME_SIZE / naturalW;
        const scaleY = FRAME_SIZE / naturalH;
        minScaleLimit = Math.max(scaleX, scaleY);

        if (magnet.transform && magnet.transform.zoom) {
            // שחזור מלא של מצב עריכה קיים
            bgTranslateX = magnet.transform.x * FRAME_SIZE; 
            bgTranslateY = magnet.transform.y * FRAME_SIZE;
            bgScale = magnet.transform.zoom * minScaleLimit;
        } else {
            // אתחול ראשוני - משתמש באותה לוגיקה של כפתור האיפוס
            applyDefaultPositioning(naturalW, naturalH);
        }
        
        clampPosition();
    }

    // פונקציה מרכזית לחישוב מיקום ה-Default (Top Align)
    function applyDefaultPositioning(w, h) {
        // איפוס סקייל למינימום שמכסה את המסגרת
        bgScale = minScaleLimit;
        
        // מכיוון שנקודת הייחוס (Transform Origin) היא המרכז (Center Center):
        // X=0 ממקם את מרכז התמונה במרכז המסגרת (וזה מה שאנחנו רוצים אופקית ב-Landscape וגם ב-Portrait זה בסדר כי זה ממלא רוחב).
        bgTranslateX = 0; 

        // Y=0 ממקם את מרכז התמונה במרכז המסגרת.
        // אבל הדרישה היא Top Align (הצמדה למעלה).
        // כדי להזיז את התמונה כך שהחלק העליון שלה ייגע בחלק העליון של המסגרת,
        // עלינו להזיז אותה "למטה" (חיובי) בחצי מההפרש שבין הגובה הנוכחי למסגרת.
        
        const currentH = h * bgScale;
        
        // הנוסחה: (גובה התמונה בפועל - גובה המסגרת) / 2
        // זה יתן את ה-Offset החיובי הנדרש כדי שראש התמונה יהיה ב-0.
        bgTranslateY = (currentH - FRAME_SIZE) / 2;
    }

    function clampPosition() {
        if (!bgImageEl) return;

        const naturalW = bgImageEl.naturalWidth;
        const naturalH = bgImageEl.naturalHeight;

        const currentW = naturalW * bgScale;
        const currentH = naturalH * bgScale;

        // גבולות גזרה: לא מאפשרים לראות רקע לבן בתוך המסגרת
        const maxX = (currentW - FRAME_SIZE) / 2;
        const maxY = (currentH - FRAME_SIZE) / 2;

        if (bgTranslateX > maxX) bgTranslateX = maxX;
        if (bgTranslateX < -maxX) bgTranslateX = -maxX;
        
        if (bgTranslateY > maxY) bgTranslateY = maxY;
        if (bgTranslateY < -maxY) bgTranslateY = -maxY;
    }

    // --- אירועי גרירה ואינטראקציה ---

    function startInteraction() { isInteracting = true; }
    function endInteraction() { isDragging = false; isInteracting = false; }

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
                bgScale = pendingZoomMultiplier * minScaleLimit;
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
        const naturalW = bgImageEl.naturalWidth;
        const naturalH = bgImageEl.naturalHeight;
        const scaleX = FRAME_SIZE / naturalW;
        const scaleY = FRAME_SIZE / naturalH;
        minScaleLimit = Math.max(scaleX, scaleY);

        // שימוש בלוגיקה המרכזית
        applyDefaultPositioning(naturalW, naturalH);
        
        clampPosition();
        applyEffect('original');
    }

    function saveAndClose() {
        // שמירת ערכים יחסיים (באחוזים/יחס) כדי שיתאימו לכל גודל בגריד
        updateMagnetTransform(magnetId, {
            zoom: bgScale / minScaleLimit,
            x: bgTranslateX / FRAME_SIZE,
            y: bgTranslateY / FRAME_SIZE
        });
        goto('/uploader');
    }

    function applyEffect(effectId) {
        // עדכון האפקט הנוכחי במגנט עצמו (לוגיקה ויזואלית תמיד תרוץ)
        updateMagnetActiveEffect(magnetId, effectId);

        // אם אין מגנט, או שהאפקט הוא "מקורי", או שאין Worker פעיל – אין צורך בעיבוד נוסף
        if (!magnet || effectId === 'original' || !effectsWorker) {
            return;
        }

        const isAlreadyProcessed = magnet.processed && magnet.processed[effectId];
        if (!isAlreadyProcessed) {
            updateMagnetProcessedSrc(magnetId, effectId, 'processing');
            effectsWorker.postMessage({ magnetId, effectId, originalSrc: magnet.originalSrc });
        }
    }
    
    function deleteMagnet() {
        if (confirm('למחוק את התמונה?')) {
            magnets.update(list => list.filter(m => m.id !== magnetId));
            goto('/uploader');
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
            <div class="image-layer">
                <div
                    class="movable-content"
                    style="transform: translate({bgTranslateX}px, {bgTranslateY}px) scale({bgScale});"
                >
                    <img
                        src={displaySrc}
                        bind:this={bgImageEl}
                        on:load={onBgImageLoad}
                        style="{activeFilterCss}"
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
            <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={bgScale / (minScaleLimit || 1)}
                on:input={handleZoomInput}
                on:change={endZoomInteraction}
            >
            <span class="hint">צבוט או גרור לזום ומיקום</span>
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
    <div class="effects-list theme-scroll">
        {#each effectsList as effect (effect.id)}
            <button class="effect-select-btn" class:active={effect.id === currentEffectId} on:click={() => applyEffect(effect.id)}>
                <div class="thumbnail-wrapper theme-shadow">
                    <img src="/effects.png" alt={effect.name} style="filter: {effect.filter};">
                </div>
                <span class="theme-text">{effect.name}</span>
            </button>
        {/each}
    </div>
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
        padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px) + var(--vv-bottom-chrome, 0px));
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
        transform-origin: center center;
        will-change: transform;
        display: flex; justify-content: center; align-items: center;
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
        background: rgba(255, 255, 255, 0.94);
        border-top: 1px solid rgba(0, 0, 0, 0.06);
        box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.06);
        touch-action: manipulation;
    }
    .zoom-controls:hover,
    .editor-page.is-interacting .zoom-controls {
        opacity: 1;
    }
    .zoom-controls input {
        width: 100%;
        height: 8px;
        background: rgba(0, 0, 0, 0.12);
        border-radius: 4px;
        -webkit-appearance: none;
        appearance: none;
    }
    .zoom-controls input::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 24px;
        height: 24px;
        background: var(--color-pink);
        border: 2px solid white;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    }
    .zoom-controls input::-moz-range-thumb {
        width: 24px;
        height: 24px;
        background: var(--color-pink);
        border: 2px solid white;
        border-radius: 50%;
        cursor: pointer;
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
    .effects-list { display: flex; gap: 15px; padding: 10px; overflow-x: auto; }
    .thumbnail-wrapper { width: 60px; height: 60px; border-radius: 8px; overflow: hidden; margin-bottom: 5px; }
    .thumbnail-wrapper img { width: 100%; height: 100%; object-fit: cover; }
    .effect-select-btn { background: none; border: none; cursor: pointer; display: flex; flex-direction: column; align-items: center; }
    .effect-select-btn.active .thumbnail-wrapper { border: 2px solid var(--color-pink); }
    
    /* 🔥 מוביל: הסרת גלילה מיותרת באפקטים */
    @media (max-width: 768px) {
        .effects-list {
            overflow-x: visible !important; /* ללא גלילה אופקית במוביל */
            justify-content: space-between; /* פיזור אחיד של האפקטים */
            gap: 10px;
            padding: 5px 0;
        }
        
        /* הסרת theme-scroll במוביל */
        .effects-list.theme-scroll {
            overflow-y: visible !important;
        }
    }
</style>