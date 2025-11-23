<svelte:head>
    <title>FEEL - עריכת מגנט</title>
</svelte:head>

<script>
    import { onMount, onDestroy } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { magnets, editorSettings, updateMagnetProcessedSrc, updateMagnetTransform, updateMagnetActiveEffect } from '$lib/stores.js';
    import FloatingPanel from '$lib/components/FloatingPanel.svelte'; 

    // --- רשימת אפקטים ---
    const effectsList = [
        { id: 'original', name: 'מקורי', filter: 'none' },
        { id: 'silver', name: 'כסף', filter: 'url(#filter-silver)' },
        { id: 'noir', name: 'נואר', filter: 'url(#filter-noir)' },
        { id: 'vivid', name: 'עז', filter: 'url(#filter-vivid)' },
        { id: 'dramatic', name: 'דרמטי', filter: 'url(#filter-dramatic)' }
    ];

    // --- קריאת נתונים ---
    const magnetId = $page.params.magnetId;
    let magnet;
    $: magnet = $magnets.find(m => m.id === magnetId); // הפכנו לריאקטיבי
    
    // --- משתני עריכה מקומיים (זום ומיקום) ---
    let currentEditZoom = magnet?.transform.zoom || 1;
    let currentEditX = magnet?.transform.x || 0;
    let currentEditY = magnet?.transform.y || 0;
    
    // 🔥 שינוי: נגדיר את נתוני האיפוס כקבועים
    const originalEditData = { 
        zoom: 1, 
        x: 0, // זהו יחס (ratio)
        y: 0  // זהו יחס (ratio)
    };
    
    // --- משתני גרירה (זום ומיקום) ---
    let isEditingDrag = false;
    let editStartPosX = 0;
    let editStartPosY = 0;
    let editImageEl;

    // --- לוגיקה חדשה: אפקטים ---
    let effectsWorker;
    let activePanel = null; 
    
    $: currentEffectId = magnet?.activeEffectId || 'original'; 
    $: processedSrc = magnet?.processed[currentEffectId];
    $: isLoadingEffect = processedSrc === 'processing';
    
    $: displaySrc = (processedSrc && processedSrc !== 'processing') 
                    ? processedSrc 
                    : magnet?.originalSrc;

    onMount(() => {
        if (!magnet) {
            goto('/uploader');
            return; 
        }

        // 🔥 התיקון: המרת היחסים (מה-store) לפיקסלים (של עמוד העריכה) ---
        const frameSize = editImageEl.clientWidth; // גודל מסגרת העריכה
        
        currentEditZoom = magnet.transform.zoom;
        // המר מיחס (0.1) לפיקסלים (0.1 * 400 = 40px)
        currentEditX = magnet.transform.x * frameSize; 
        currentEditY = magnet.transform.y * frameSize;
        
        // החל את הטרנספורם בפעם הראשונה
        applyEditTransform(); 

        effectsWorker = new Worker('/effects.worker.js');
        effectsWorker.onmessage = (event) => {
            const { status, magnetId: processedMagnetId, effectId, newSrc } = event.data;
            if (status === 'success' && processedMagnetId === magnetId) {
                updateMagnetProcessedSrc(magnetId, effectId, newSrc);
            }
        };
    });

    onDestroy(() => {
        if (effectsWorker) {
            effectsWorker.terminate();
        }
    });

    /**
     * פונקציה חדשה: החלת אפקט
     */
    function applyEffect(effectId) {
        updateMagnetActiveEffect(magnetId, effectId);
        activePanel = null;

        if (effectId !== 'original' && !magnet.processed[effectId]) {
            updateMagnetProcessedSrc(magnetId, effectId, 'processing');
            effectsWorker.postMessage({
                magnetId: magnetId,
                effectId: effectId,
                originalSrc: magnet.originalSrc
            });
        }
    }

    function applyEditTransform() {
        if (!editImageEl) return;
        const frameWidth = editImageEl.clientWidth;
        const frameHeight = editImageEl.clientHeight;
        const scaledWidth = frameWidth * currentEditZoom;
        const scaledHeight = frameHeight * currentEditZoom;
        
        const maxMoveX = Math.max(0, (scaledWidth - frameWidth) / 2 / currentEditZoom);
        const maxMoveY = Math.max(0, (scaledHeight - frameHeight) / 2 / currentEditZoom);

        currentEditX = Math.max(-maxMoveX, Math.min(maxMoveX, currentEditX));
        currentEditY = Math.max(-maxMoveY, Math.min(maxMoveY, currentEditY));
        
        editImageEl.style.transform = `scale(${currentEditZoom}) translate(${currentEditX}px, ${currentEditY}px)`;
    }

    function handleZoomInput(e) {
        currentEditZoom = parseFloat(e.target.value);
        applyEditTransform();
    }

    /**
     * 🔥 פונקציית איפוס מתוקנת 🔥
     */
    function resetEditTransform() {
        // 1. אפס זום ומיקום לערכי "מפעל"
        currentEditZoom = originalEditData.zoom; // 1
        currentEditX = originalEditData.x; // 0
        currentEditY = originalEditData.y; // 0
        applyEditTransform();
        
        // 2. אפס את האפקט ל"מקורי"
        applyEffect('original');
    }

    function saveAndClose() {
        // --- 🔥 התיקון: המר מפיקסלים בחזרה ליחסים ---
        const frameSize = editImageEl.clientWidth;
        // המר מפיקסלים (40px) ליחס (40 / 400 = 0.1)
        const savedX_ratio = currentEditX / frameSize;
        const savedY_ratio = currentEditY / frameSize;

        updateMagnetTransform(magnetId, {
            zoom: currentEditZoom,
            x: savedX_ratio, // שמור יחס
            y: savedY_ratio  // שמור יחס
        });
        goto('/uploader'); 
    }
    
    function cancelAndClose() {
        goto('/uploader');
    }

    function getEventPosition(e) {
        return e.touches ? e.touches[0] : e;
    }

    function startEditDrag(e) {
        e.preventDefault();
        isEditingDrag = true;
        const pos = getEventPosition(e);
        editStartPosX = pos.clientX;
        editStartPosY = pos.clientY;
        
        editImageEl.style.transition = 'none';
    }

    function editDrag(e) {
        if (!isEditingDrag) return;
        e.preventDefault();
        const pos = getEventPosition(e);
        
        const deltaX = (pos.clientX - editStartPosX);
        const deltaY = (pos.clientY - editStartPosY);

        currentEditX += (deltaX / currentEditZoom);
        currentEditY += (deltaY / currentEditZoom);
        
        editStartPosX = pos.clientX;
        editStartPosY = pos.clientY;
        
        applyEditTransform();
    }

    function endEditDrag() {
        if (!isEditingDrag) return;
        isEditingDrag = false;
        editImageEl.style.transition = 'transform 0.1s ease-out';
    }

</script>

<svelte:window 
    on:mousemove={editDrag} 
    on:mouseup={endEditDrag}
    on:touchmove|preventDefault={editDrag}
    on:touchend={endEditDrag}
/>

{#if magnet}
<div class="edit-canvas-container">
    <div class="edit-frame">
        <img 
            src={displaySrc} 
            id="edit-image" 
            alt="עריכת תמונה"
            bind:this={editImageEl}
            style="transform: scale({currentEditZoom}) translate({currentEditX}px, {currentEditY}px);"
            on:mousedown={startEditDrag}
            on:touchstart|preventDefault={startEditDrag}
        />
        {#if isLoadingEffect}
            <div class="magnet-loader">
                <div class="loader-spinner"></div>
            </div>
        {/if}
    </div>
</div>

<footer id="bottom-toolbar-edit" class="bottom-toolbar controls-active">
    <button class="toolbar-btn" on:click={cancelAndClose}>ביטול</button>
    <div class="zoom-slider-container">
        <span>-</span>
        <input 
            type="range" 
            id="zoom-slider" 
            min="1" max="3" 
            bind:value={currentEditZoom} 
            step="0.01"
            on:input={handleZoomInput}
        >
        <span>+</span>
    </div>
    <button class="toolbar-btn" on:click={resetEditTransform}>אפס</button>
    
    <button class="toolbar-btn" on:click={() => activePanel = 'effects'}>אפקטים</button>
    
    <button class="toolbar-btn" id="edit-save-btn" on:click={saveAndClose}>שמור שינויים</button>
</footer>

<FloatingPanel 
    title="בחר אפקט" 
    isOpen={activePanel === 'effects'} 
    on:close={() => activePanel = null}
>
    <div class="effects-list">
        {#each effectsList as effect (effect.id)}
            <button 
                class="effect-select-btn"
                class:active={effect.id === currentEffectId}
                on:click={() => applyEffect(effect.id)}
            >
                <div class="thumbnail-wrapper">
                    <img 
                        src="/effects.png" 
                        alt={effect.name}
                        style="filter: {effect.filter};"
                    >
                </div>
                <span>{effect.name}</span>
            </button>
        {/each}
    </div>
</FloatingPanel>

<style>
    .magnet-loader {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        background: rgba(255,255,255,0.5);
        box-sizing: border-box;
        border-radius: 12px;
    }
    .loader-spinner {
        width: 30px;
        height: 30px;
        border: 4px solid var(--color-pink);
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
</style>
{/if}