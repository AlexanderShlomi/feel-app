<script>
    import { onMount, onDestroy, tick } from 'svelte';
    import Magnet from '$lib/components/Magnet.svelte';
    import FloatingPanel from '$lib/components/FloatingPanel.svelte';
    import FileUploader from '$lib/components/FileUploader.svelte';
    import MosaicEditor from '$lib/components/MosaicEditor.svelte';
    
    import { draggable } from '$lib/actions/draggable.js';
    import { findBestTargetSlot, reflowMagnets, placeNewMagnets } from '$lib/utils/grid.js';
    
    import { 
        magnets, 
        editorSettings, 
        addUploadedMagnets,
        updateMagnetProcessedSrc, 
        getFullMagnetSize, 
        getMargin,
        isMobile,
        getMinGridBase,
        SPLIT_MAGNET_SIZE,    
        SPLIT_MARGIN_PERCENT, 
        SCALE_MIN,    
        SCALE_MAX,      
        SCALE_DEFAULT  
    } from '$lib/stores.js';

    const effectsList = [
        { id: 'original', name: 'מקורי', filter: 'none' },
        { id: 'silver', name: 'כסף', filter: 'url(#filter-silver)' },
        { id: 'noir', name: 'נואר', filter: 'url(#filter-noir)' },
        { id: 'vivid', name: 'עז', filter: 'url(#filter-vivid)' },
        { id: 'dramatic', name: 'דרמטי', filter: 'url(#filter-dramatic)' }
    ];

    let effectsWorker;
    let activePanel = null;
    let loaderEl;
    let surfaceEl;
    let resizeObserver;
    let isSplitEditing = false;
    let splitRenderFrame;
    let resizeTimeout;

    // --- Lifecycle Management ---
    onMount(() => {
        window.addEventListener('dragstart', (e) => e.preventDefault());
        
        checkMobile();
        ensureValidScale();
        initWorker();
        initResizeObserver();
        
        tick().then(() => {
            if ($editorSettings.currentMode === 'multi') {
                updateMagnetsSize();
                if ($magnets.length > 0) {
                   const needsPlacement = !$magnets[0].position || $magnets[0].position.x === 0;
                   if (needsPlacement) fillEmptySlots();
                   else updateSurfaceHeight();
                }
            } else if ($editorSettings.splitImageSrc) { 
                calculateAndRenderSplitGrid();
            }
        });
    });

    onDestroy(() => {
        if (effectsWorker) effectsWorker.terminate();
        if (resizeObserver) resizeObserver.disconnect();
        if (splitRenderFrame) cancelAnimationFrame(splitRenderFrame);
        if (resizeTimeout) clearTimeout(resizeTimeout);
    });

    // --- Helpers ---
    function checkMobile() {
        if (window.innerWidth < 768) isMobile.set(true);
        else isMobile.set(false);
    }

    function ensureValidScale() {
        let currentScale = $editorSettings.currentDisplayScale;
        if (!currentScale || currentScale < SCALE_MIN || currentScale > SCALE_MAX) {
            editorSettings.update(s => ({ ...s, currentDisplayScale: SCALE_DEFAULT }));
        }
    }

    function initWorker() {
        effectsWorker = new Worker('/effects.worker.js');
        effectsWorker.onmessage = (event) => {
            const { status, magnetId, effectId, blob } = event.data;
            if (status === 'success') {
                const newSrc = URL.createObjectURL(blob);
                if (magnetId === 'split-master') {
                    editorSettings.update(s => {
                        const newCache = { ...s.splitImageCache, [effectId]: newSrc };
                        return { ...s, splitImageCache: newCache };
                    });
                    magnets.update(list => list.map(m => ({ ...m, src: newSrc })));
                    if (loaderEl) loaderEl.style.display = 'none';
                } else {
                    updateMagnetProcessedSrc(magnetId, effectId, newSrc);
                }
            }
        };
    }

    function initResizeObserver() {
        if (!surfaceEl || !surfaceEl.parentElement) return;

        resizeObserver = new ResizeObserver(() => {
            if (resizeTimeout) clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                const newWidth = surfaceEl.parentElement.clientWidth;
                const mobileDetected = newWidth < 768;
                
                if ($isMobile !== mobileDetected) {
                    isMobile.set(mobileDetected);
                }
                
                if (!mobileDetected && $editorSettings.currentMode === 'multi') {
                    handleReflow();
                }
            }, 100);
        });
        
        resizeObserver.observe(surfaceEl.parentElement);
    }

    // --- Core Logic Actions ---

    function togglePanel(name) {
        activePanel = activePanel === name ? null : name;
    }

    function handleReflow() {
        if ($isMobile) return; 
        if ($magnets.length === 0 || $editorSettings.currentMode !== 'multi' || !surfaceEl) {
            updateSurfaceHeight();
            return;
        }
        
        const surfaceWidth = surfaceEl.parentElement.clientWidth;
        const itemFullSize = getFullMagnetSize();
        const margin = getMargin();
        
        const newLayout = reflowMagnets($magnets, surfaceWidth, itemFullSize, margin);
        magnets.set(newLayout);
        tick().then(updateSurfaceHeight);
    }

    function fillEmptySlots() {
        if ($isMobile || !surfaceEl) return;
        
        const surfaceWidth = surfaceEl.parentElement.clientWidth;
        const itemFullSize = getFullMagnetSize(); 
        const margin = getMargin();
        
        const newLayout = placeNewMagnets($magnets, surfaceWidth, itemFullSize, margin);
        magnets.set(newLayout);
        tick().then(updateSurfaceHeight);
    }

    function updateSurfaceHeight() {
        if ($isMobile) {
             editorSettings.update(s => ({ ...s, surfaceMinHeight: '100%' }));
             return;
        }
        if (!surfaceEl || $magnets.length === 0) {
            editorSettings.update(s => ({ ...s, surfaceMinHeight: '100%' }));
            return;
        }
        
        let maxBottom = 0;
        let margin = ($editorSettings.currentMode === 'multi') ? getMargin() : 50;
        
        $magnets.forEach(item => {
            const bottomPosition = item.position.y + item.size;
            if (bottomPosition > maxBottom) maxBottom = bottomPosition;
        });
        
        const totalHeight = maxBottom + margin;
        const containerHeight = surfaceEl.parentElement.clientHeight;
        editorSettings.update(s => ({ ...s, surfaceMinHeight: `${Math.max(totalHeight, containerHeight)}px` }));
    }

    function updateMagnetsSize() {
        const newSize = getFullMagnetSize();
        magnets.update(list => list.map(m => ({ ...m, size: newSize })));
    }

    // --- Drag & Drop (Multi Mode) ---
    function onMagnetDragEnd(event) {
        if ($isMobile) return; 
        const { x, y, id } = event;
        const itemFullSize = getFullMagnetSize();
        const margin = getMargin();
        const gridStep = itemFullSize + margin; 
        const surfaceWidth = surfaceEl.parentElement.clientWidth;
        
        const cols = Math.floor((surfaceWidth - margin) / gridStep);
        const numCols = Math.max(1, cols);
        
        const bestSlot = findBestTargetSlot(x, y, margin, gridStep, numCols);
        
        let snapX, snapY;
        if (bestSlot) {
            snapX = margin + (bestSlot.col * gridStep);
            snapY = margin + (bestSlot.row * gridStep);
        } else {
            snapX = x;
            snapY = y;
        }
        
        magnets.update(list => 
            list.map(m => m.id === id ? { ...m, position: { x: snapX, y: snapY } } : m)
        );
        
        setTimeout(updateSurfaceHeight, 300);
    }

    // --- Upload Handlers ---
    function triggerUploadAction() {
        const elementId = $editorSettings.currentMode === 'multi' ? 'upload-multi-input' : 'upload-split-input';
        const el = document.getElementById(elementId);
        if (el) el.click();
    }

    async function onMultiFilesSelected(event) {
        const files = event.detail;
        if (!files || files.length === 0) return;
        
        loaderEl.style.display = 'block'; 
        await addUploadedMagnets(files);
        updateMagnetsSize();
        
        loaderEl.style.display = 'none';
        
        if (!$isMobile) {
            fillEmptySlots();
        }
    }
    
    // --- Split / Mosaic Mode Logic ---
    function onSplitImageLoaded(event) {
        const { src, ratio } = event.detail;
        loaderEl.style.display = 'block';
        
        editorSettings.update(s => ({ 
            ...s, 
            splitImageSrc: src,
            splitImageRatio: ratio,
            gridBaseSize: getMinGridBase(),
            currentEffect: 'original',
            splitTransform: { zoom: 1, x: 0, y: 0, xPct: 0, yPct: 0 },
            splitImageCache: { original: null, silver: null, noir: null, vivid: null, dramatic: null }
        }));
        
        calculateAndRenderSplitGrid(); 
    }

    function calculateAndRenderSplitGrid() {
        if (splitRenderFrame) cancelAnimationFrame(splitRenderFrame);
        
        splitRenderFrame = requestAnimationFrame(() => {
            const $settings = $editorSettings;
            if ($settings.currentMode !== 'split' || !$settings.splitImageSrc) return;
            
            const imageRatio = $settings.splitImageRatio;
            const base = $settings.gridBaseSize;
            
            let cols, rows;
            if (imageRatio > 1) { cols = Math.round(base * imageRatio); rows = base; } 
            else { rows = Math.round(base / imageRatio); cols = base; }
            
            const size = SPLIT_MAGNET_SIZE; 
            const gap = size * SPLIT_MARGIN_PERCENT;
            const step = size + gap;
            
            const totalGridWidth = (cols * size) + ((cols - 1) * gap);
            const totalGridHeight = (rows * size) + ((rows - 1) * gap);
            
            let bgWidth, bgHeight;
            if (imageRatio > (totalGridWidth / totalGridHeight)) {
                bgHeight = Math.ceil(totalGridHeight) + 2;
                bgWidth = Math.ceil(bgHeight * imageRatio);
            } else {
                bgWidth = Math.ceil(totalGridWidth) + 2;
                bgHeight = Math.ceil(bgWidth / imageRatio);
            }
            
            const userTransform = $settings.splitTransform || { zoom: 1, x: 0, y: 0, xPct: 0, yPct: 0 };
            const finalBgWidth = bgWidth * userTransform.zoom;
            const finalBgHeight = bgHeight * userTransform.zoom;
            const startX = (totalGridWidth - finalBgWidth) / 2 + (userTransform.xPct || 0) * finalBgWidth;
            const startY = (totalGridHeight - finalBgHeight) / 2 + (userTransform.yPct || 0) * finalBgHeight;
            
            const currentEffect = $settings.currentEffect || 'original';
            let imageSource = ($settings.splitImageCache && $settings.splitImageCache[currentEffect]) 
                              ? $settings.splitImageCache[currentEffect] 
                              : $settings.splitImageSrc;
            
            let newMagnets = [];
            const count = cols * rows;
            
            for (let i = 0; i < count; i++) {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const magnetX = col * step;
                const magnetY = row * step;
                
                newMagnets.push({
                    id: `split-${row}-${col}`, 
                    src: imageSource, 
                    originalSrc: $settings.splitImageSrc, 
                    isSplitPart: true,
                    hidden: false, 
                    size: size, 
                    position: { x: magnetX, y: magnetY },
                    transform: { 
                        bgWidth: finalBgWidth, bgHeight: finalBgHeight, 
                        bgPosX: startX - magnetX, bgPosY: startY - magnetY,
                        zoom: 1 
                    }
                });
            }
            
            magnets.set(newMagnets);
            
            if (surfaceEl) {
                const h = (rows * step) - gap;
                editorSettings.update(s => ({...s, surfaceMinHeight: `${Math.max(h, surfaceEl.parentElement.clientHeight)}px`}));
            }
            if (loaderEl) loaderEl.style.display = 'none';
        });
    }

    function handleSaveMosaic(event) {
        const newTransform = event.detail;
        if (loaderEl) loaderEl.style.display = 'block';
        
        editorSettings.update(s => ({ ...s, splitTransform: newTransform }));
        isSplitEditing = false;
        
        tick().then(() => setTimeout(calculateAndRenderSplitGrid, 50));
    }

    // --- Toolbar Actions ---
    function handleSizeChange(event) {
        const newScale = parseFloat(event.target.value);
        editorSettings.update(s => ({ ...s, currentDisplayScale: newScale }));
        
        requestAnimationFrame(() => {
            updateMagnetsSize();
            if ($editorSettings.currentMode === 'multi' && !$isMobile) handleReflow();
        });
    }

    function applyEffectToAllMagnets(effectId) {
        editorSettings.update(s => ({ ...s, currentEffect: effectId }));
        magnets.update(list => list.map(m => ({ ...m, activeEffectId: effectId })));
        
        if (effectId === 'original') {
            if ($editorSettings.currentMode === 'split') {
                magnets.update(list => list.map(m => ({ ...m, src: m.originalSrc })));
            }
            return;
        }
        
        if ($editorSettings.currentMode === 'split') {
            if ($editorSettings.splitImageCache && $editorSettings.splitImageCache[effectId]) {
                const cachedSrc = $editorSettings.splitImageCache[effectId];
                magnets.update(list => list.map(m => ({ ...m, src: cachedSrc })));
            } else {
                if (loaderEl) loaderEl.style.display = 'block';
                effectsWorker.postMessage({ magnetId: 'split-master', effectId: effectId, originalSrc: $editorSettings.splitImageSrc });
            }
        } else {
            for (const magnet of $magnets) {
                if (!magnet.processed || !magnet.processed[effectId]) {
                    updateMagnetProcessedSrc(magnet.id, effectId, 'processing');
                    effectsWorker.postMessage({ magnetId: magnet.id, effectId: effectId, originalSrc: magnet.originalSrc });
                }
            }
        }
    }

    function changeGridSize(delta) {
        const currentSize = $editorSettings.gridBaseSize;
        const newSize = currentSize + delta;
        
        if (newSize < getMinGridBase()) return;
        
        if (loaderEl) loaderEl.style.display = 'block';
        setTimeout(() => {
            editorSettings.update(s => ({ ...s, gridBaseSize: newSize })); 
            calculateAndRenderSplitGrid(); 
        }, 50);
    }

    function handleDeleteRequest(event) {
        const id = event.detail.id;
        magnets.update(list => list.filter(m => m.id !== id));
        if (!$isMobile) tick().then(handleReflow);
    }

    function handleToggleVisibility(event) {
        const id = event.detail.id;
        magnets.update(list => list.map(m => {
            if (m.id === id) return { ...m, hidden: !m.hidden };
            return m;
        }));
    }
</script>

<div class="canvas-container" class:container-dark={$editorSettings.isSurfaceDark} class:split-center={$editorSettings.currentMode === 'split'}>
    
    <div 
        id="configurator-surface" 
        bind:this={surfaceEl} 
        style="min-height: {$editorSettings.surfaceMinHeight};"
        class:surface-dark={$editorSettings.isSurfaceDark}
        class:carousel-mode={$isMobile && $editorSettings.currentMode === 'multi'}
    >
        {#each $magnets as magnet (magnet.id)}
            <div 
                class="magnet-wrapper"
                class:draggable-active={$editorSettings.currentMode === 'multi' && !$isMobile}
                style="
                    {$isMobile ? '' : `left: ${magnet.position.x}px; top: ${magnet.position.y}px; width: ${magnet.size}px; height: ${magnet.size}px;`}
                "
                use:draggable={{
                    enabled: $editorSettings.currentMode === 'multi' && !$isMobile, 
                    onDragEnd: (e) => onMagnetDragEnd({ ...e, id: magnet.id })
                }}
            >
                <Magnet 
                    {...magnet}
                    position={$isMobile ? magnet.position : {x: 0, y: 0}} 
                    on:delete={handleDeleteRequest}
                    on:toggleVisibility={handleToggleVisibility} 
                    on:dblclick={(e) => e.preventDefault()} 
                />
            </div>
        {/each}
    </div>
        
    {#if $magnets.length === 0 && !$editorSettings.splitImageSrc}
    <div id="initial-upload-prompt">
        <button id="initial-upload-btn" on:click={triggerUploadAction}>
            {#if $editorSettings.currentMode === 'multi'}
                הוסף תמונות
            {:else}
                <div class="mosaic-icon">
                    <span></span><span></span><span></span>
                    <span></span><span></span><span></span>
                    <span></span><span></span><span></span>
                </div>
            {/if}
        </button>
        {#if $editorSettings.currentMode === 'split'}
            <span id="initial-upload-text">בחר תמונה לפיצול</span>
        {/if}
    </div>
    {/if}
</div>

{#if $magnets.length > 0 || $editorSettings.splitImageSrc}
<footer class="bottom-toolbar controls-active">
    
    <button class="toolbar-btn" on:click={() => togglePanel('effects')}>אפקטים</button>
    <button class="toolbar-btn" on:click={() => editorSettings.update(s => ({...s, isSurfaceDark: !s.isSurfaceDark}))}>החלף רקע</button> 

    {#if $editorSettings.currentMode === 'multi'}
        {#if !$isMobile}
            <button class="toolbar-btn" on:click={() => { handleReflow(); activePanel = null; }}>סדר מחדש</button>
            <button class="toolbar-btn" on:click={() => togglePanel('size')}>גודל תצוגה</button>
        {/if}
        <button class="toolbar-add-btn" on:click={() => { triggerUploadAction(); activePanel = null; }}>+</button>
    {/if}

    {#if $editorSettings.currentMode === 'split'}
         <button class="toolbar-btn" on:click={() => { triggerUploadAction(); activePanel = null; }}>החלף תמונה</button>
         
         <div class="split-controls-group"> 
             <button class="split-btn" on:click={() => changeGridSize(-1)} disabled={$editorSettings.gridBaseSize <= getMinGridBase()}>-</button>
             <span id="split-grid-display">גודל רשת</span>
             <button class="split-btn" on:click={() => changeGridSize(1)}>+</button>
         </div>
         
         <button class="toolbar-btn icon-only-btn" on:click={() => isSplitEditing = true} title="חיתוך ומיקוד">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;">
                <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"></path>
                <path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"></path>
             </svg>
         </button>
    {/if}
</footer>
{/if}

<FileUploader 
    uploadId="upload-multi-input" 
    mode="multi" 
    on:uploadStart={() => loaderEl.style.display = 'block'}
    on:filesSelected={onMultiFilesSelected} 
/>
<FileUploader 
    uploadId="upload-split-input" 
    mode="split" 
    on:uploadStart={() => loaderEl.style.display = 'block'}
    on:splitImageLoaded={onSplitImageLoaded} 
/>

<div class="brand-loader-bar" id="loader" bind:this={loaderEl} style="display: none;">
    <div class="loader-progress"></div>
</div>

<FloatingPanel title="גודל תצוגה" isOpen={activePanel === 'size'} on:close={() => activePanel = null}>
    <div class="size-slider-container">
        <span>-</span>
        <input type="range" min={SCALE_MIN} max={SCALE_MAX} step="0.01" value={$editorSettings.currentDisplayScale} on:input={handleSizeChange}>
        <span>+</span>
    </div>
</FloatingPanel>

<FloatingPanel title="בחר אפקט" isOpen={activePanel === 'effects'} on:close={() => activePanel = null}>
    <div class="effects-list">
        {#each effectsList as effect (effect.id)}
            <button class="effect-select-btn" class:active={effect.id === $editorSettings.currentEffect} on:click={() => applyEffectToAllMagnets(effect.id)}>
                <div class="thumbnail-wrapper">
                    <img src="/effects.png" alt={effect.name} style="filter: {effect.filter};">
                </div>
                <span>{effect.name}</span>
            </button>
        {/each}
    </div>
</FloatingPanel>

{#if isSplitEditing && $editorSettings.splitImageSrc}
    <MosaicEditor 
        imageSrc={$editorSettings.splitImageSrc}
        transform={$editorSettings.splitTransform}
        gridSettings={{ 
            cols: $editorSettings.gridBaseSize * ($editorSettings.splitImageRatio > 1 ? $editorSettings.splitImageRatio : 1), 
            rows: $editorSettings.gridBaseSize * ($editorSettings.splitImageRatio > 1 ? 1 : (1/$editorSettings.splitImageRatio)) 
        }}
        on:save={handleSaveMosaic}
        on:close={() => isSplitEditing = false}
    />
{/if}

<style>
    .magnet-wrapper {
        position: absolute; 
        touch-action: none; 
        z-index: 10;
        /* הוספנו כאן את המידות והמיקום באופן דינמי ב-HTML */
    }
    
    .magnet-wrapper.draggable-active {
        z-index: 1000;
        cursor: grabbing;
    }
    
    #configurator-surface {
        background-color: #F2F0EC; 
        transition: background-color 0.3s ease;
        position: relative;
    }
    #configurator-surface.surface-dark { background-color: #1E1E1E; }
    
    /* קרוסלת מובייל */
    #configurator-surface.carousel-mode {
        display: flex;
        flex-direction: row; 
        flex-wrap: nowrap; 
        overflow-x: auto; 
        align-items: center; 
        justify-content: flex-start;
        padding: 0 40px; 
        gap: 20px; 
        scroll-snap-type: x mandatory; 
        -webkit-overflow-scrolling: touch;
        height: 70vh; 
    }
    
    #configurator-surface.carousel-mode .magnet-wrapper {
        position: relative !important; 
        left: auto !important;
        top: auto !important;
        /* כאן לא צריך רוחב וגובה קבועים, המגנט הפנימי יקבע אותם */
        width: auto !important; 
        height: auto !important;
        flex: 0 0 auto; 
        scroll-snap-align: center; 
    }
    
    .mosaic-icon { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; width: 24px; height: 24px; }
    .mosaic-icon span { background-color: currentColor; border-radius: 1px; width: 100%; height: 100%; }
    .canvas-container.split-center #configurator-surface { display: flex; justify-content: center; align-items: center; }
    
    .brand-loader-bar { position: fixed; bottom: 0; left: 0; width: 100%; height: 6px; background-color: #F2F0EC; z-index: 9999; overflow: hidden; }
    .loader-progress { width: 100%; height: 100%; background: linear-gradient(90deg, #3F524F, #846349, #475160, #3F524F); background-size: 200% 100%; animation: brandLoading 1.5s infinite linear; }
    @keyframes brandLoading { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
    
    .split-controls-group { display: flex; align-items: center; gap: 10px; }
    .split-btn { border: 2px solid var(--color-pink); background: transparent; color: var(--color-pink); width: 40px; height: 40px; border-radius: 50%; font-size: 24px; font-weight: 700; cursor: pointer; }
    .split-btn:hover { background: var(--color-pink); color: white; }
    .split-btn:disabled { border-color: #ccc; color: #ccc; cursor: not-allowed; background: transparent; }
    #split-grid-display { font-size: 16px; font-weight: 700; color: var(--color-medium-blue-gray); width: 80px; text-align: center; }
    
    .size-slider-container { display: flex; align-items: center; gap: 15px; }
    .size-slider-container span { font-size: 16px; color: var(--color-medium-blue-gray); }
    
    .effects-list { display: flex; gap: 15px; justify-content: center; padding: 5px 0; overflow-x: auto; }
    .effect-select-btn { background: none; border: none; cursor: pointer; padding: 0; font-family: 'Assistant', sans-serif; font-size: 14px; color: var(--color-medium-blue-gray); font-weight: 600; display: flex; flex-direction: column; align-items: center; gap: 5px; }
    .effect-select-btn .thumbnail-wrapper { width: 80px; height: 80px; border-radius: 8px; border: 3px solid transparent; overflow: hidden; }
    .effect-select-btn .thumbnail-wrapper img { width: 100%; height: 100%; object-fit: cover; }
    .effect-select-btn.active .thumbnail-wrapper { border-color: var(--color-pink); }
    
    .icon-only-btn { padding: 8px; display: flex; align-items: center; justify-content: center; }
</style>