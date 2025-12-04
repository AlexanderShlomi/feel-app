<script>
    import { createEventDispatcher } from 'svelte';
    
    export let imageSrc;
    export let transform = { zoom: 1, x: 0, y: 0 };
    export let gridSettings = { cols: 3, rows: 3 };

    const dispatch = createEventDispatcher();
    
    let viewportEl;
    let imageEl;
    let isDragging = false;
    let startX, startY;
    let initialX, initialY;

    let localTransform = { ...transform };
    $: localTransform = { ...transform };

    function handleMouseDown(e) {
        e.preventDefault();
        isDragging = true;
        const src = e.touches ? e.touches[0] : e;
        startX = src.clientX;
        startY = src.clientY;
        initialX = localTransform.x;
        initialY = localTransform.y;
        
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        window.addEventListener('touchmove', handleMove, { passive: false });
        window.addEventListener('touchend', handleUp);
    }

    function handleMove(e) {
        if (!isDragging) return;
        if (e.cancelable) e.preventDefault();
        const src = e.touches ? e.touches[0] : e;
        
        const dx = src.clientX - startX;
        const dy = src.clientY - startY;

        localTransform.x = initialX + dx;
        localTransform.y = initialY + dy;
    }

    function handleUp() {
        isDragging = false;
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
        window.removeEventListener('touchmove', handleMove);
        window.removeEventListener('touchend', handleUp);
    }

    function onSave() {
        const imgW = imageEl.clientWidth * localTransform.zoom;
        const imgH = imageEl.clientHeight * localTransform.zoom;
        const xPct = imgW > 0 ? localTransform.x / imgW : 0;
        const yPct = imgH > 0 ? localTransform.y / imgH : 0;

        dispatch('save', {
            ...localTransform,
            xPct,
            yPct
        });
    }

    function onReset() {
        localTransform = { zoom: 1, x: 0, y: 0 };
    }
</script>

<div class="split-editor-overlay">
    <div class="split-editor-container">
        <div class="split-editor-header">
            <h3>הזז והגדל את התמונה</h3>
            <button class="close-editor-btn" on:click={() => dispatch('close')}>✕</button>
        </div>
        
        <div 
            class="split-editor-viewport"
            bind:this={viewportEl}
            on:mousedown={handleMouseDown}
            on:touchstart|nonpassive={handleMouseDown} 
        >
            <img 
                src={imageSrc} 
                bind:this={imageEl}
                style="transform: translate({localTransform.x}px, {localTransform.y}px) scale({localTransform.zoom});"
                draggable="false"
            />
            
            <div class="grid-overlay" style="--cols: {gridSettings.cols}; --rows: {gridSettings.rows};"></div>
        </div>

        <div class="split-editor-controls">
            <button class="editor-action-btn cancel" on:click={() => dispatch('close')}>ביטול</button>
            <div class="zoom-slider-wrapper">
                <span>-</span>
                <input type="range" min="1" max="3" step="0.01" bind:value={localTransform.zoom}>
                <span>+</span>
            </div>
            <button class="editor-action-btn reset" on:click={onReset}>אפס</button>
            <button class="editor-action-btn save" on:click={onSave}>שמור</button>
        </div>
    </div>
</div>

<style>
    .split-editor-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.85); z-index: 2000;
        display: flex; justify-content: center; align-items: center;
        animation: fadeIn 0.3s;
    }
    
    .split-editor-container {
        background: white; 
        width: 95%; max-width: 600px; max-height: 90vh; 
        border-radius: 12px; overflow: hidden;
        display: flex; flex-direction: column;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }

    .split-editor-header {
        padding: 15px; display: flex; justify-content: space-between; align-items: center;
        border-bottom: 1px solid #eee; background: white;
        flex-shrink: 0;
    }
    .split-editor-header h3 { margin: 0; font-size: 18px; color: #333; }
    .close-editor-btn { background: none; border: none; font-size: 20px; cursor: pointer; color: #666; }
    
    .split-editor-viewport {
        position: relative; background: #333; overflow: hidden;
        display: flex; justify-content: center; align-items: center;
        cursor: grab; margin: 0 auto;
        width: 100%; 
        height: 50vh; min-height: 300px; max-height: 500px;
        
        /* ✅ תיקון קריטי לדפדפנים מודרניים: מונע גלילה בזמן גרירת התמונה */
        touch-action: none;
    }
    
    @media (max-height: 600px) {
        .split-editor-viewport { height: 40vh; }
    }

    .split-editor-viewport:active { cursor: grabbing; }
    
    .split-editor-viewport img {
        max-width: 100%; max-height: 100%;
        transform-origin: center; pointer-events: none; user-select: none;
    }

    .grid-overlay {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        pointer-events: none;
        background-image: 
            linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px);
        background-size: calc(100% / var(--cols, 3)) calc(100% / var(--rows, 3));
        border: 2px solid rgba(255,255,255,0.6);
        box-sizing: border-box;
    }

    .split-editor-controls {
        padding: 15px; display: flex; justify-content: space-between; align-items: center;
        gap: 15px; background: #f9f9f9; border-top: 1px solid #eee;
        flex-shrink: 0;
    }
    .zoom-slider-wrapper { display: flex; align-items: center; gap: 10px; flex-grow: 1; color: #333; }
    .zoom-slider-wrapper input { width: 100%; cursor: pointer; }
    
    .editor-action-btn {
        padding: 8px 16px; border: none; border-radius: 6px;
        font-weight: 500; cursor: pointer; font-size: 14px;
        white-space: nowrap; 
    }
    .editor-action-btn.cancel { background: transparent; color: #666; }
    .editor-action-btn.reset { background: #eee; color: #333; }
    .editor-action-btn.save { background: #1E1E1E; color: #F2F0EC; }
    
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
</style>