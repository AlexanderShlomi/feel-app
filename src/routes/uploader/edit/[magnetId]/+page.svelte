<svelte:head>
    <title>FEEL - עריכת מגנט</title>
</svelte:head>

<script>
    import { onMount, onDestroy } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    // הוספתי את getFilterStyle לייבוא
    import { magnets, editorSettings, updateMagnetProcessedSrc, updateMagnetTransform, updateMagnetActiveEffect, getFilterStyle } from '$lib/stores.js';
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
    
    let isEditingDrag = false;
    let editStartPosX = 0;
    let editStartPosY = 0;
    let editImageEl;
    let effectsWorker;
    let activePanel = null; 
    
    $: currentEffectId = magnet?.activeEffectId || 'original'; 
    // שינוי קריטי: התצוגה תמיד משתמשת במקור, הפילטר מוחל ב-CSS
    $: displaySrc = magnet?.originalSrc;
    // אנו עדיין עוקבים אחרי העיבוד לשמירה, אבל לא לתצוגה
    $: processedSrc = magnet?.processed[currentEffectId];
    $: isLoadingEffect = processedSrc === 'processing';

    // חישוב הפילטר לתצוגה
    $: activeFilterCss = getFilterStyle(currentEffectId);

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
        // Worker runs ONLY for saving purposes now
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
        // לוגיקת גרירה וזום נשארת זהה
        editImageEl.style.transform = `scale(${currentEditZoom}) translate(${currentEditX}px, ${currentEditY}px)`;
    }

    // ... (פונקציות עזר: handleZoomInput, resetEditTransform, saveAndClose, deleteMagnet, Drag Logic - ללא שינוי) ...
    function handleZoomInput(e) {
        currentEditZoom = parseFloat(e.target.value);
        applyEditTransform();
    }
    function resetEditTransform() {
        currentEditZoom = 1; currentEditX = 0; currentEditY = 0;
        applyEditTransform();
        applyEffect('original');
    }
    function saveAndClose() {
        const frameSize = editImageEl.clientWidth;
        updateMagnetTransform(magnetId, {
            zoom: currentEditZoom,
            x: currentEditX / frameSize, 
            y: currentEditY / frameSize  
        });
        goto('/uploader'); 
    }
    function deleteMagnet() {
        if (confirm('למחוק את התמונה?')) {
            magnets.update(list => list.filter(m => m.id !== magnetId));
            goto('/uploader');
        }
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

<div class="brand-loader-bar" style="display: {isLoadingEffect ? 'block' : 'none'};">
    <div class="loader-progress"></div>
</div>

{#if magnet}
<div class="edit-canvas-container">
    <div class="edit-frame">
        <img 
            src={displaySrc} 
            id="edit-image" 
            alt="עריכת תמונה"
            bind:this={editImageEl}
            style="{activeFilterCss} transform: scale({currentEditZoom}) translate({currentEditX}px, {currentEditY}px);"
            on:mousedown={startEditDrag}
            on:touchstart|preventDefault={startEditDrag}
        />
        {#if isLoadingEffect}
            <div class="magnet-loader">
                <div class="loader-spinner"></div>
            </div>
        {/if}
    </div>

    <div class="slider-control-area">
        <input 
            type="range" 
            id="zoom-slider-canvas" 
            min="1" max="3" 
            bind:value={currentEditZoom} 
            step="0.01"
            on:input={handleZoomInput}
        >
        <span class="slider-hint">גרור להתאמת גודל</span>
    </div>
</div>

<footer id="bottom-toolbar-edit" class="glass-dock">
    <button class="dock-btn-text" on:click={resetEditTransform}>אפס</button>
    <button class="dock-btn-text" on:click={() => activePanel = 'effects'}>אפקטים</button>
    
    <div class="dock-divider"></div>

    <button class="dock-btn-circle danger" on:click={deleteMagnet} title="מחק">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
    </button>

    <button class="dock-btn-circle primary" on:click={saveAndClose}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
    </button>
</footer>

<FloatingPanel 
    title="בחר אפקט" 
    isOpen={activePanel === 'effects'} 
    on:close={() => activePanel = null}
>
    <div class="effects-list theme-scroll">
        {#each effectsList as effect (effect.id)}
            <button 
                class="effect-select-btn"
                class:active={effect.id === currentEffectId}
                on:click={() => applyEffect(effect.id)}
            >
                <div class="thumbnail-wrapper theme-shadow">
                    <img 
                        src="/effects.png" 
                        alt={effect.name}
                        style="filter: {effect.filter};"
                    >
                </div>
                <span class="theme-text">{effect.name}</span>
            </button>
        {/each}
    </div>
</FloatingPanel>

<style>
    .brand-loader-bar { position: fixed; top: 0; left: 0; width: 100%; height: 6px; background-color: transparent; z-index: 99999; overflow: hidden; pointer-events: none; }
    .loader-progress { width: 100%; height: 100%; background: linear-gradient(90deg, var(--color-pink), var(--color-gold), var(--color-pink)); background-size: 200% 100%; animation: brandLoading 1.5s infinite linear; }
    .edit-canvas-container { width: 100%; height: calc(100vh - 90px); display: flex; flex-direction: column; justify-content: center; align-items: center; background-color: var(--color-canvas-bg); overflow: hidden; gap: 25px; }
    .edit-frame { width: 300px; height: 300px; position: relative; overflow: hidden; border-radius: 4px; box-shadow: 0 10px 40px rgba(0,0,0,0.15); background: white; flex-shrink: 0; }
    #edit-image { width: 100%; height: 100%; object-fit: cover; } /* הסרתי transform ו-filter מפה כי הם מגיעים מ-inline style */
    .slider-control-area { width: 300px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .slider-control-area input[type=range] { width: 100%; height: 4px; background: #ccc; border-radius: 2px; -webkit-appearance: none; appearance: none; outline: none; }
    .slider-control-area input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px; border-radius: 50%; background: white; border: 2px solid var(--color-pink); cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
    .slider-hint { font-size: 14px; color: var(--color-medium-blue-gray); font-weight: 500; }
    .glass-toolbar { background: var(--color-light-gray); border-top: 1px solid rgba(0,0,0,0.05); padding: 15px 30px; display: flex; justify-content: center; align-items: center; gap: 20px; position: fixed; bottom: 0; left: 0; width: 100%; box-sizing: border-box; z-index: 100; box-shadow: 0 -2px 5px rgba(0,0,0,0.1); flex-wrap: wrap; }
    .toolbar-btn { background: none; border: none; cursor: pointer; font-family: 'Assistant', sans-serif; font-size: 16px; font-weight: 600; color: var(--color-medium-blue-gray); padding: 10px; transition: color 0.2s; display: flex; align-items: center; justify-content: center; }
    .toolbar-btn:hover { color: var(--color-pink); }
    .icon-btn-clean svg { width: 20px; height: 20px; stroke: #e53935; }
    .icon-btn-clean:hover svg { stroke: #d32f2f; }
    .save-circle-btn { background-color: var(--color-pink); color: #ffffff; width: 50px; height: 50px; border-radius: 50%; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(63, 82, 79, 0.2); transition: transform 0.2s; }
    .save-circle-btn:hover { transform: scale(1.1); }
    .save-circle-btn svg { width: 24px; height: 24px; }
    .theme-scroll { padding: 10px 20px; gap: 20px; overflow-x: auto; display: flex; }
    .thumbnail-wrapper.theme-shadow { border-radius: 12px; width: 70px; height: 70px; overflow: hidden; border: 2px solid transparent; }
    .theme-text { font-family: 'Assistant', sans-serif; font-size: 13px; margin-top: 6px; font-weight: 600; color: var(--color-medium-blue-gray); }
    .effect-select-btn { display: flex; flex-direction: column; align-items: center; border: none; background: none; cursor: pointer; }
    .effect-select-btn.active .thumbnail-wrapper { border-color: var(--color-pink); }
</style>
{/if}