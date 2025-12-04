<svelte:head>
    <title>FEEL - עריכת מגנט</title>
</svelte:head>

<script>
    import { onMount, onDestroy } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { magnets, editorSettings, updateMagnetProcessedSrc, updateMagnetTransform, updateMagnetActiveEffect } from '$lib/stores.js';
    import FloatingPanel from '$lib/components/FloatingPanel.svelte'; 

    const effectsList = [
        { id: 'original', name: 'מקורי', filter: 'none' },
        { id: 'silver', name: 'כסף', filter: 'url(#filter-silver)' },
        { id: 'noir', name: 'נואר', filter: 'url(#filter-noir)' },
        { id: 'vivid', name: 'עז', filter: 'url(#filter-vivid)' },
        { id: 'dramatic', name: 'דרמטי', filter: 'url(#filter-dramatic)' }
    ];

    const magnetId = $page.params.magnetId;
    let magnet;
    $: magnet = $magnets.find(m => m.id === magnetId); 
    
    let currentEditZoom = magnet?.transform.zoom || 1;
    let currentEditX = magnet?.transform.x || 0;
    let currentEditY = magnet?.transform.y || 0;
    
    const originalEditData = { zoom: 1, x: 0, y: 0 };
    
    let isEditingDrag = false;
    let editStartPosX = 0;
    let editStartPosY = 0;
    let editImageEl;

    let effectsWorker;
    let activePanel = null; 
    
    $: currentEffectId = magnet?.activeEffectId || 'original'; 
    $: processedSrc = magnet?.processed[currentEffectId];
    $: isLoadingEffect = processedSrc === 'processing';
    $: displaySrc = (processedSrc && processedSrc !== 'processing') ? processedSrc : magnet?.originalSrc;

    onMount(() => {
        if (!magnet) {
            goto('/uploader');
            return; 
        }

        const frameSize = editImageEl.clientWidth; 
        currentEditZoom = magnet.transform.zoom;
        currentEditX = magnet.transform.x * frameSize; 
        currentEditY = magnet.transform.y * frameSize;
        
        applyEditTransform(); 

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
    });

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

    function resetEditTransform() {
        currentEditZoom = originalEditData.zoom; 
        currentEditX = originalEditData.x; 
        currentEditY = originalEditData.y; 
        applyEditTransform();
        applyEffect('original');
    }

    function saveAndClose() {
        const frameSize = editImageEl.clientWidth;
        const savedX_ratio = currentEditX / frameSize;
        const savedY_ratio = currentEditY / frameSize;

        updateMagnetTransform(magnetId, {
            zoom: currentEditZoom,
            x: savedX_ratio, 
            y: savedY_ratio  
        });
        goto('/uploader'); 
    }
    
    function cancelAndClose() {
        goto('/uploader');
    }

    function getEventPosition(e) { return e.touches ? e.touches[0] : e; }

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

<footer id="bottom-toolbar-edit" class="bottom-toolbar controls-active edit-mode-toolbar">
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

    <div class="actions-row">
        <button class="toolbar-btn secondary" on:click={cancelAndClose}>ביטול</button>
        <button class="toolbar-btn" on:click={resetEditTransform}>אפס</button>
        <button class="toolbar-btn" on:click={() => activePanel = 'effects'}>אפקטים</button>
        <button class="toolbar-btn primary" id="edit-save-btn" on:click={saveAndClose}>שמור</button>
    </div>
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
    /* ... (שאר הסגנונות הקודמים נשארים) ... */

    /* --- עיצוב ייעודי למובייל לעמוד העריכה --- */
    .actions-row {
        display: contents; /* בדסקטופ הכפתורים רגילים */
    }

    @media (max-width: 768px) {
        .edit-mode-toolbar {
            flex-direction: row !important; /* שומר על שורה אחת */
            flex-wrap: wrap; /* מאפשר ירידת שורה אם צפוף */
            height: auto !important;
            padding: 15px !important;
            gap: 10px !important;
            background: white;
            justify-content: center; /* מרכוז הכפתורים */
            align-items: center;
        }

        .zoom-slider-container {
            width: 100% !important; /* סליידר לרוחב מלא בשורה נפרדת */
            padding: 0 10px 10px 10px; /* רווח תחתון מהכפתורים */
            box-sizing: border-box;
        }

        .actions-row {
            display: flex;
            width: 100%;
            justify-content: space-around; /* פיזור אחיד של הכפתורים */
            align-items: center;
            gap: 10px; /* רווח קטן בין הכפתורים */
        }

        .toolbar-btn {
            font-size: 14px;
            padding: 10px 15px; /* כפתורים קצת יותר גדולים ללחיצה */
            flex-grow: 1; /* מאפשר לכפתורים להתרחב מעט */
            text-align: center;
            max-width: 100px; /* שלא יהיו רחבים מדי */
        }
        
        #edit-save-btn {
            background-color: var(--color-pink);
            color: white;
            padding: 10px 20px;
            border-radius: 20px;
            /* כפתור שמירה יהיה מעט בולט יותר */
            flex-grow: 1.2;
        }
    }
</style>
{/if}