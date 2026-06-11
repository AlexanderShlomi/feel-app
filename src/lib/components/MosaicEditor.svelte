<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { beginUserInteraction, endUserInteraction } from '$lib/stores.js';
    
    export let imageSrc;
    export let transform = { zoom: 1, x: 0, y: 0 };
    export let gridSettings = { cols: 3, rows: 3 };
    export let imageRatio = 1; // יחס רוחב:גובה של התמונה – לקביעת כיוון התצוגה (אופקי/אנכי)
    
    const dispatch = createEventDispatcher();
    
    let containerEl;
    let viewportEl;
    let imageEl;
    let resizeObserver;
    
    // משתני עריכה
    let scale = 1; 
    let translateX = 0;
    let translateY = 0;
    
    // משתני חישוב (לשימוש פנימי)
    let containerWidth = 0;
    let containerHeight = 0;
    let imgDisplayWidth = 0;
    let imgDisplayHeight = 0;
    
    // גרירה
    let isDragging = false;
    let startX = 0, startY = 0;
    let startTransX = 0, startTransY = 0;

    // צביטה (Pinch-zoom) – שתי אצבעות
    let isPinching = false;
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let pinchPrevMidX = 0, pinchPrevMidY = 0;

    // Skeleton – מוצג עד שהתמונה נטענת (אחיד עם העורך: 1.5s pulse)
    let imgLoaded = false;
    let showSkeleton = true;

    // אתחול – שימוש ב-ResizeObserver להתאמה למרחב הזמין בפועל
    onMount(() => {
        calculateLayout();
        requestAnimationFrame(() => calculateLayout());
        // If the blob was already decoded (cache), `on:load` won't fire — reveal now.
        if (imageEl?.complete && imageEl.naturalWidth) imgLoaded = true;
        if (viewportEl && window.ResizeObserver) {
            resizeObserver = new ResizeObserver(() => calculateLayout());
            resizeObserver.observe(viewportEl);
        }
        window.addEventListener('resize', calculateLayout);
        return () => {
            window.removeEventListener('resize', calculateLayout);
            if (resizeObserver && viewportEl) resizeObserver.unobserve(viewportEl);
        };
    });

    // 1. חישוב גודל מסגרת החיתוך – מותאם לכיוון התמונה (אופקי/אנכי)
    function calculateLayout() {
        if (!containerEl) return;

        const cols = gridSettings.cols;
        const rows = gridSettings.rows;
        const gridRatio = cols / rows;

        // שימוש במרחב הזמין ב-viewport אם קיים, אחרת חלון
        let maxWidth = window.innerWidth * 0.9;
        let maxHeight = window.innerHeight * 0.55;
        if (viewportEl) {
            const rect = viewportEl.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                maxWidth = rect.width;
                maxHeight = rect.height;
            }
        }

        let finalW = maxWidth;
        let finalH = finalW / gridRatio;
        if (finalH > maxHeight) {
            finalH = maxHeight;
            finalW = finalH * gridRatio;
        }

        containerWidth = finalW;
        containerHeight = finalH;
        
        if (imageEl) {
            if (imageEl.complete) setupImage();
            else imageEl.onload = setupImage;
        }
    }

    // 2. חישוב התמונה (Cover Logic)
    function setupImage() {
        if (!imageEl) return;
        const natW = imageEl.naturalWidth;
        const natH = imageEl.naturalHeight;
        
        // חישוב היחסים בין התמונה למסגרת
        const ratioW = containerWidth / natW;
        const ratioH = containerHeight / natH;

        // כדי לבצע Cover (כיסוי מלא), אנחנו צריכים את היחס הגדול מביניהם
        // זה מבטיח שלא יהיו "חורים" לבנים בצדדים
        const baseScale = Math.max(ratioW, ratioH);

        // חישוב הגודל הפיזי של התמונה על המסך (במצב זום 1)
        imgDisplayWidth = natW * baseScale;
        imgDisplayHeight = natH * baseScale;

        // שחזור עריכה קודמת אם קיימת
        if (transform && transform.zoom) {
            scale = transform.zoom;
            // v2 (preferred): xPct/yPct are normalized to allowed overflow range [-1..1]
            const currentW = imgDisplayWidth * scale;
            const currentH = imgDisplayHeight * scale;
            const maxX = Math.max(0, (currentW - containerWidth) / 2);
            const maxY = Math.max(0, (currentH - containerHeight) / 2);

            if (typeof transform.xPct === 'number' || typeof transform.yPct === 'number') {
                const xp = typeof transform.xPct === 'number' ? transform.xPct : 0;
                const yp = typeof transform.yPct === 'number' ? transform.yPct : 0;
                const clampedXp = Math.max(-1, Math.min(1, xp));
                const clampedYp = Math.max(-1, Math.min(1, yp));
                translateX = clampedXp * maxX;
                translateY = clampedYp * maxY;
            } else {
                // Legacy: pixel translations
                translateX = transform.x || 0;
                translateY = transform.y || 0;
            }
        } else {
            resetPosition();
        }
        
        clamp(); // וידוא שהתמונה לא בורחת
    }

    function resetPosition() {
        scale = 1;
        translateX = 0;
        translateY = 0;
        clamp();
    }

    // --- גרירה (Drag) + צביטה (Pinch) ---
    function touchDist(a, b) {
        return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
    }

    function handleMouseDown(e) {
        if (e.cancelable) e.preventDefault();
        beginUserInteraction();

        // שתי אצבעות → התחלת צביטה (שמירת מרחק/זום בסיסיים)
        if (e.touches && e.touches.length >= 2) {
            isPinching = true;
            isDragging = false;
            const t1 = e.touches[0], t2 = e.touches[1];
            pinchStartDist = touchDist(t1, t2);
            pinchStartScale = scale;
            pinchPrevMidX = (t1.clientX + t2.clientX) / 2;
            pinchPrevMidY = (t1.clientY + t2.clientY) / 2;
            addGlobalListeners();
            return;
        }

        isPinching = false;
        isDragging = true;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        startX = clientX;
        startY = clientY;
        startTransX = translateX;
        startTransY = translateY;

        addGlobalListeners();
    }

    function handleMove(e) {
        if (e.cancelable) e.preventDefault();

        // מצב צביטה: יחס המרחק בין האצבעות → זום (1..3), והמרכז גורר את התמונה
        if (isPinching && e.touches && e.touches.length >= 2) {
            const t1 = e.touches[0], t2 = e.touches[1];
            const dist = touchDist(t1, t2);
            const midX = (t1.clientX + t2.clientX) / 2;
            const midY = (t1.clientY + t2.clientY) / 2;

            scale = Math.max(1, Math.min(3, pinchStartScale * (dist / pinchStartDist)));
            translateX += midX - pinchPrevMidX;
            translateY += midY - pinchPrevMidY;
            pinchPrevMidX = midX;
            pinchPrevMidY = midY;

            clamp();
            return;
        }

        if (!isDragging) return;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const dx = clientX - startX;
        const dy = clientY - startY;

        translateX = startTransX + dx;
        translateY = startTransY + dy;

        clamp(); // הגבלה בזמן אמת
    }

    function handleUp(e) {
        // צביטה שמסתיימת אך אצבע אחת נשארה → חזרה לגרירה רגילה ללא קפיצה
        if (e && e.touches && e.touches.length === 1) {
            isPinching = false;
            isDragging = true;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            startTransX = translateX;
            startTransY = translateY;
            return;
        }
        isDragging = false;
        isPinching = false;
        removeGlobalListeners();
        endUserInteraction();
    }

    function onImgLoad() {
        imgLoaded = true;
    }
    function onSkeletonTransitionEnd(e) {
        if (e.propertyName === 'opacity' && imgLoaded) showSkeleton = false;
    }

    function addGlobalListeners() {
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        window.addEventListener('touchmove', handleMove, { passive: false });
        window.addEventListener('touchend', handleUp);
    }

    function removeGlobalListeners() {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
        window.removeEventListener('touchmove', handleMove);
        window.removeEventListener('touchend', handleUp);
    }

    function handleZoom(e) {
        beginUserInteraction();
        scale = parseFloat(e.target.value);
        clamp();
    }

    function handleCropKeyDown(e) {
        const key = e.key;
        const step = e.shiftKey ? 25 : 10;
        if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
            e.preventDefault();
            beginUserInteraction();
            if (key === 'ArrowLeft') translateX -= step;
            if (key === 'ArrowRight') translateX += step;
            if (key === 'ArrowUp') translateY -= step;
            if (key === 'ArrowDown') translateY += step;
            clamp();
            // End interaction on next tick to avoid blocking autosave too long.
            setTimeout(() => endUserInteraction(), 0);
        }
    }

    // 3. הגבלת גבולות (Constraints)
    // הפונקציה מחשבת את ה"עודף" של התמונה מעבר למסגרת ומונעת גרירה מעבר לו.
    function clamp() {
        // גודל התמונה הנוכחי (כולל זום)
        const currentW = imgDisplayWidth * scale;
        const currentH = imgDisplayHeight * scale;

        // חישוב הגבול המקסימלי להזזה (לכל צד)
        // הנוסחה: (רוחב תמונה פחות רוחב מסגרת) חלקי 2
        const maxX = (currentW - containerWidth) / 2;
        const maxY = (currentH - containerHeight) / 2;

        // נעילה: הערך המוחלט של ההזזה לא יכול לעבור את המקסימום
        if (translateX > maxX) translateX = maxX;
        if (translateX < -maxX) translateX = -maxX;
        
        if (translateY > maxY) translateY = maxY;
        if (translateY < -maxY) translateY = -maxY;
    }

    function onSave() {
        // שמירה מדויקת (v2): xPct/yPct הם יחס מה-overscroll המותר [-1..1].
        // מאפשר שחזור 1:1 בכל גודל מסך/גריד.
        const currentW = imgDisplayWidth * scale;
        const currentH = imgDisplayHeight * scale;
        const maxX = Math.max(0, (currentW - containerWidth) / 2);
        const maxY = Math.max(0, (currentH - containerHeight) / 2);
        
        dispatch('save', {
            zoom: scale,
            x: translateX,
            y: translateY,
            xPct: maxX > 0 ? Math.max(-1, Math.min(1, translateX / maxX)) : 0,
            yPct: maxY > 0 ? Math.max(-1, Math.min(1, translateY / maxY)) : 0
        });
    }
</script>

<div class="mosaic-editor-overlay">
    <div class="mosaic-editor-card" class:landscape={imageRatio > 1} class:portrait={imageRatio <= 1}>
        <div class="header">
            <h3>הזז והגדל את התמונה</h3>
            <button class="close-btn" on:click={() => dispatch('close')}>✕</button>
        </div>

        <div class="viewport-area" bind:this={viewportEl}>
            <div 
                class="crop-box" 
                bind:this={containerEl}
                style="width: {containerWidth}px; height: {containerHeight}px;"
                role="button"
                tabindex="0"
                aria-label="הזז את התמונה במסגרת"
                on:mousedown={handleMouseDown}
                on:touchstart={handleMouseDown}
                on:keydown={handleCropKeyDown}
            >
                <img
                    src={imageSrc}
                    bind:this={imageEl}
                    on:load={onImgLoad}
                    style="
                        width: {imgDisplayWidth}px;
                        height: {imgDisplayHeight}px;
                        transform: translate({translateX}px, {translateY}px) scale({scale});
                    "
                    draggable="false"
                    loading="eager"
                    decoding="async"
                    alt="editing source"
                />

                <div 
                    class="grid-lines" 
                    style="
                        grid-template-columns: repeat({gridSettings.cols}, 1fr);
                        grid-template-rows: repeat({gridSettings.rows}, 1fr);
                    "
                >
                    {#each Array(gridSettings.cols * gridSettings.rows) as _}
                        <div class="cell"></div>
                    {/each}
                </div>

                {#if showSkeleton}
                    <div
                        class="mosaic-skeleton-wrap"
                        class:mosaic-skeleton-wrap--fade-out={imgLoaded}
                        on:transitionend={onSkeletonTransitionEnd}
                        aria-hidden="true"
                    >
                        <div class="mosaic-skeleton mosaic-skeleton--pulse"></div>
                    </div>
                {/if}
            </div>
        </div>

        <div class="controls">
            <button class="text-btn" on:click={() => dispatch('close')}>ביטול</button>
            
            <div class="slider-wrapper">
                <span class="icon">-</span>
                <input 
                    type="range" 
                    min="1" max="3" step="0.01" 
                    value={scale} 
                    on:input={handleZoom}
                    on:change={() => endUserInteraction()}
                >
                <span class="icon">+</span>
            </div>

            <button class="text-btn" on:click={resetPosition}>אפס</button>
            <button class="save-btn" on:click={onSave}>שמור</button>
        </div>
    </div>
</div>

<style>
    .mosaic-editor-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.85); z-index: 9999;
        display: flex; justify-content: center; align-items: center;
        animation: fadeIn 0.2s ease-out;
    }

    .mosaic-editor-card {
        background: white;
        width: 95%;
        border-radius: 16px;
        display: flex; flex-direction: column;
        overflow: hidden;
        box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    }
    /* תמונה אופקית – כרטיס רחב לחיתוך אופקי */
    .mosaic-editor-card.landscape {
        max-width: min(850px, 92vw);
        max-height: 85vh;
        max-height: 85dvh;
    }
    /* תמונה אנכית – כרטיס צר לחיתוך אנכי */
    .mosaic-editor-card.portrait {
        max-width: min(450px, 92vw);
        max-height: 90vh;
        max-height: 90dvh;
    }

    .header {
        padding: 15px 20px; display: flex; justify-content: space-between; align-items: center;
        border-bottom: 1px solid #eee;
    }
    .header h3 { margin: 0; font-size: 18px; color: #333; }
    .close-btn { background: none; border: none; font-size: 24px; cursor: pointer; color: #999; padding: 0; line-height: 1; }

    .viewport-area {
        background: #1a1a1a;
        padding: 30px;
        display: flex; justify-content: center; align-items: center;
        flex-grow: 1;
        overflow: hidden;
    }

    .crop-box {
        position: relative;
        overflow: hidden; /* חיתוך החלקים שיוצאים */
        box-shadow: 0 0 0 1px rgba(255,255,255,0.3);
        background: #000;

        display: flex; justify-content: center; align-items: center;
        cursor: grab;
        /* קריטי ל-pinch: מונע מהדפדפן לחטוף את מחוות שתי האצבעות כ-page-zoom */
        touch-action: none;
    }
    .crop-box:active { cursor: grabbing; }

    /* Skeleton – אחיד עם העורך (1.5s pulse), בצבע בהיר כי הרקע כהה */
    .mosaic-skeleton-wrap {
        position: absolute;
        inset: 0;
        z-index: 5;
        pointer-events: none;
        background: #1a1a1a;
        opacity: 1;
        transition: opacity 0.4s ease-out;
    }
    .mosaic-skeleton-wrap--fade-out { opacity: 0; }
    .mosaic-skeleton {
        position: absolute;
        inset: 0;
        background: rgba(255, 255, 255, 0.08);
    }
    .mosaic-skeleton--pulse {
        animation: mosaicSkeletonPulse 1.5s ease-in-out infinite;
    }
    @keyframes mosaicSkeletonPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
    }

    .crop-box img {
        display: block;
        max-width: none;
        pointer-events: none;
        user-select: none;
        transform-origin: center center;
        will-change: transform;
    }

    /* הגריד הויזואלי */
    .grid-lines {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        display: grid;
        pointer-events: none;
        border: 2px solid rgba(255,255,255,0.8);
        box-sizing: border-box;
    }

    .cell {
        border: 1px solid rgba(255,255,255,0.4);
    }

    .controls {
        padding: 15px 20px;
        padding-bottom: max(15px, env(safe-area-inset-bottom, 0px));
        background: #fff;
        border-top: 1px solid #eee;
        display: flex;
        align-items: center;
        gap: 15px;
        flex-shrink: 0;
    }

    .slider-wrapper {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 0;
        touch-action: manipulation;
    }
    .icon { font-weight: bold; color: #666; font-size: 18px; }
    
    input[type='range'] {
        width: 100%;
        height: 10px;
        cursor: pointer;
        -webkit-appearance: none;
        appearance: none;
    }
    input[type='range']::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: var(--color-pink, #3f524f);
        border: 2px solid #fff;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    }

    .text-btn { background: none; border: none; cursor: pointer; font-weight: 600; color: #666; font-size: 14px; }
    .save-btn { background: #1E1E1E; color: white; border: none; padding: 8px 20px; border-radius: 20px; font-weight: 700; cursor: pointer; font-size: 14px; }

    @keyframes fadeIn { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
</style>