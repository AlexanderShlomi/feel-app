<script>
    import { createEventDispatcher, onMount } from 'svelte';
    
    export let imageSrc;
    export let transform = { zoom: 1, x: 0, y: 0 };
    export let gridSettings = { cols: 3, rows: 3 };
    
    const dispatch = createEventDispatcher();
    
    let containerEl;
    let imageEl;
    
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

    // אתחול
    onMount(() => {
        calculateLayout();
        window.addEventListener('resize', calculateLayout);
        return () => window.removeEventListener('resize', calculateLayout);
    });

    // 1. חישוב גודל מסגרת החיתוך (Container)
    // המסגרת חייבת להיות ביחס מדויק של העמודות/שורות כדי שהתאים יהיו ריבועים.
    function calculateLayout() {
        if (!containerEl) return;

        // שטח מקסימלי במסך
        const maxWidth = window.innerWidth * 0.9;
        const maxHeight = window.innerHeight * 0.55;

        const cols = gridSettings.cols;
        const rows = gridSettings.rows;

        // היחס של הגריד כולו (בהנחה שכל תא הוא ריבוע 1:1)
        const gridRatio = cols / rows;

        // ניסיון להתאים לפי רוחב
        let finalW = maxWidth;
        let finalH = finalW / gridRatio;

        // אם הגובה חורג, מתאימים לפי גובה
        if (finalH > maxHeight) {
            finalH = maxHeight;
            finalW = finalH * gridRatio;
        }

        containerWidth = finalW;
        containerHeight = finalH;
        
        // לאחר קביעת המסגרת, טוענים את התמונה
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
            translateX = transform.x;
            translateY = transform.y;
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

    // --- גרירה (Drag) ---
    function handleMouseDown(e) {
        if (e.cancelable) e.preventDefault();
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
        if (!isDragging) return;
        if (e.cancelable) e.preventDefault();

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const dx = clientX - startX;
        const dy = clientY - startY;

        translateX = startTransX + dx;
        translateY = startTransY + dy;

        clamp(); // הגבלה בזמן אמת
    }

    function handleUp() {
        isDragging = false;
        removeGlobalListeners();
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
        scale = parseFloat(e.target.value);
        clamp();
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
        // המרה לערכים יחסיים (Percentage) לשמירה בבסיס הנתונים
        // זה מאפשר לשחזר את העריכה בכל גודל מסך
        const currentW = imgDisplayWidth * scale;
        const currentH = imgDisplayHeight * scale;
        
        dispatch('save', {
            zoom: scale,
            x: translateX,
            y: translateY,
            xPct: currentW > 0 ? translateX / currentW : 0,
            yPct: currentH > 0 ? translateY / currentH : 0
        });
    }
</script>

<div class="mosaic-editor-overlay">
    <div class="mosaic-editor-card">
        <div class="header">
            <h3>הזז והגדל את התמונה</h3>
            <button class="close-btn" on:click={() => dispatch('close')}>✕</button>
        </div>

        <div class="viewport-area">
            <div 
                class="crop-box" 
                bind:this={containerEl}
                style="width: {containerWidth}px; height: {containerHeight}px;"
                on:mousedown={handleMouseDown}
                on:touchstart={handleMouseDown}
            >
                <img 
                    src={imageSrc} 
                    bind:this={imageEl}
                    style="
                        width: {imgDisplayWidth}px; 
                        height: {imgDisplayHeight}px;
                        transform: translate({translateX}px, {translateY}px) scale({scale});
                    "
                    draggable="false"
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
        width: 95%; max-width: 500px;
        border-radius: 16px;
        display: flex; flex-direction: column;
        overflow: hidden;
        box-shadow: 0 20px 50px rgba(0,0,0,0.5);
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
    }
    .crop-box:active { cursor: grabbing; }

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
        padding: 15px 20px; background: #fff; border-top: 1px solid #eee;
        display: flex; align-items: center; gap: 15px;
    }

    .slider-wrapper { flex: 1; display: flex; align-items: center; gap: 10px; }
    .icon { font-weight: bold; color: #666; font-size: 18px; }
    
    input[type=range] { width: 100%; cursor: pointer; }

    .text-btn { background: none; border: none; cursor: pointer; font-weight: 600; color: #666; font-size: 14px; }
    .save-btn { background: #1E1E1E; color: white; border: none; padding: 8px 20px; border-radius: 20px; font-weight: 700; cursor: pointer; font-size: 14px; }

    @keyframes fadeIn { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
</style>