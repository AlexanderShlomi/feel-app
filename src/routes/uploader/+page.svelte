<svelte:head>
    <title>FEEL - עורך המגנטים</title>
    <link rel="preload" href="/effects.png" as="image">
</svelte:head>

<script>
    import { onMount, onDestroy } from 'svelte';
    import Magnet from '$lib/components/Magnet.svelte';
    import FloatingPanel from '$lib/components/FloatingPanel.svelte';
    import { 
        magnets, 
        editorSettings, 
        addUploadedMagnets,
        updateMagnetProcessedSrc, 
        updateSplitImageCache,
        getFullMagnetSize, 
        getMargin,
        BASE_MAGNET_SIZE, 
        SPLIT_MARGIN_PERCENT,
        MIN_GRID_BASE,
        updateAllMagnetsActiveEffect // --- 🔥 ייבוא הפונקציה החדשה ---
    } 
    from '$lib/stores.js';

    // --- רשימת אפקטים ---
    const effectsList = [
        { id: 'original', name: 'מקורי', filter: 'none' },
        { id: 'silver', name: 'כסף', filter: 'url(#filter-silver)' },
        { id: 'noir', name: 'נואר', filter: 'url(#filter-noir)' },
        { id: 'vivid', name: 'עז', filter: 'url(#filter-vivid)' },
        { id: 'dramatic', name: 'דרמטי', filter: 'url(#filter-dramatic)' }
    ];
    
    let effectsWorker;
    let currentLayoutFn = 'grid'; 
    let currentOffsetX = 0; 

    let isDragging = false;
    let isRepositioning = false; 

    onMount(() => {
        currentOffsetX = getMargin(); 

        effectsWorker = new Worker('/effects.worker.js');
        effectsWorker.onmessage = (event) => {
            const { status, magnetId, effectId, newSrc } = event.data;
            if (status === 'success') {
                if (magnetId === 'split_image_main') {
                    updateSplitImageCache(effectId, newSrc);
                } else {
                    updateMagnetProcessedSrc(magnetId, effectId, newSrc);
                }
            }
        };

        setTimeout(() => {
            if ($editorSettings.currentMode === 'multi') {
                arrangeInGrid();
            } else if ($editorSettings.splitImageSrc) { 
                calculateAndRenderGrid();
            }
        }, 0); 
    });

    onDestroy(() => {
        if (effectsWorker) {
            effectsWorker.terminate();
        }
    });

    function handleResize() {
        if (isDragging || isRepositioning) return;
        if ($editorSettings.currentMode === 'multi') {
            if (currentLayoutFn === 'row') {
                arrangeInRow();
            } else {
                arrangeInGrid();
            }
        }
    }

    /**
     * 🔥 שינוי: מעדכן את כל המגנטים (גלובלי)
     */
    function applyEffectToAllMagnets(effectId) {
        // 1. עדכן את הגדרה הגלובלית (כדי שהפאנל יתעדכן)
        editorSettings.update(s => ({ ...s, currentEffect: effectId }));
        
        // 2. 🔥 עדכן את ה"זיכרון" האישי של כל המגנטים
        updateAllMagnetsActiveEffect(effectId);

        if (effectId === 'original') return; 
        if (!$magnets && !$editorSettings.splitImageSrc) return;

        // 3. (כמו קודם) הפעל Worker עבור כל מגנט שצריך עיבוד
        if ($editorSettings.currentMode === 'multi') {
            for (const magnet of $magnets) {
                if (!magnet.isSplitPart && magnet.processed && !magnet.processed[effectId]) {
                    updateMagnetProcessedSrc(magnet.id, effectId, 'processing');
                    effectsWorker.postMessage({
                        magnetId: magnet.id,
                        effectId: effectId,
                        originalSrc: magnet.originalSrc
                    });
                }
            }
        } else { // לוגיקת הפסיפס נשארת זהה
            const cache = $editorSettings.splitImageCache;
            if (cache && cache.original && !cache[effectId]) { 
                updateSplitImageCache(effectId, 'processing');
                effectsWorker.postMessage({
                    magnetId: 'split_image_main', 
                    effectId: effectId,
                    originalSrc: $editorSettings.splitImageSrc 
                });
            }
        }
    }

    // --- משתני פאנלים ---
    let activePanel = null;
    function togglePanel(panelName) {
        if (activePanel === panelName) {
            activePanel = null;
        } else {
            activePanel = panelName;
        }
    }
    
    // --- משתני גרירה ---
    let activeMagnetId = null;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let dragStartX = 0; 
    let dragStartY = 0;
    let surfaceRectCache; 
    let surfaceEl; 
    let multiUploadInput; 
    let splitUploadInput; 
    let loaderEl; 
    
    async function handleMultiUpload(event) {
        const files = event.target.files;
        if (files.length === 0) return;
        
        loaderEl.style.display = 'flex';
        await addUploadedMagnets(files);
        loaderEl.style.display = 'none';
        arrangeInGrid();
    }
    
    function handleSplitUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        loaderEl.style.display = 'flex';

        const reader = new FileReader();
        reader.onload = (e) => {
            const newSplitSrc = e.target.result;
            const img = new Image();
            img.onload = () => {
                const ratio = img.naturalWidth / img.naturalHeight;
                editorSettings.update(s => ({ 
                    ...s, 
                    splitImageSrc: newSplitSrc,
                    splitImageRatio: ratio,
                    gridBaseSize: MIN_GRID_BASE,
                    currentEffect: 'original',
                    splitImageCache: { 
                        original: newSplitSrc, 
                        silver: null,
                        noir: null,
                        vivid: null,
                        dramatic: null
                    }
                }));
                calculateAndRenderGrid(); 
                loaderEl.style.display = 'none';
            };
            img.src = newSplitSrc;
        };
        reader.readAsDataURL(file);
    }
    
    function updateSurfaceHeight() {
        if (!surfaceEl) return;
        let items = $magnets; 
        let margin = ($editorSettings.currentMode === 'multi') ? getMargin() : (BASE_MAGNET_SIZE * SPLIT_MARGIN_PERCENT);
        if (items.length === 0) {
            editorSettings.update(s => ({ ...s, surfaceMinHeight: '100%' }));
            return;
        }

        let maxBottom = 0;
        items.forEach(item => {
            if (item.position.y > -9000) {
                const bottomPosition = item.position.y + item.size;
                if (bottomPosition > maxBottom) {
                    maxBottom = bottomPosition;
                }
            }
        });
        const totalHeight = maxBottom + margin;
        const containerHeight = surfaceEl.parentElement.clientHeight;
        editorSettings.update(s => ({ ...s, surfaceMinHeight: `${Math.max(totalHeight, containerHeight)}px` }));
    }

    function arrangeInRow() {
        const count = $magnets.length;
        if (count === 0 || $editorSettings.currentMode !== 'multi' || !surfaceEl) { 
            updateSurfaceHeight();
            return;
        }

        const newSize = getFullMagnetSize(); 
        const margin = getMargin();
        const gridStep = newSize + margin;
        
        const surfaceWidth = surfaceEl.parentElement.clientWidth; 
        const cols = Math.floor((surfaceWidth - margin) / gridStep);
        const numCols = Math.max(1, cols); 

        currentOffsetX = margin; 

        magnets.update(currentList => 
            currentList.map((magnet, index) => {
                const row = Math.floor(index / numCols); 
                const col = index % numCols;             
                return {
                    ...magnet,
                    size: newSize, 
                    position: {
                        x: currentOffsetX + (col * gridStep),
                        y: margin + (row * gridStep)
                    }
                };
            })
        );
        setTimeout(updateSurfaceHeight, 0);
    }

    function arrangeInGrid() {
        const count = $magnets.length;
        if (count === 0 || $editorSettings.currentMode !== 'multi' || !surfaceEl) { 
            updateSurfaceHeight();
            return;
        }

        const itemFullSize = getFullMagnetSize();
        const margin = getMargin();
        const gridStep = itemFullSize + margin;
        
        const cols = Math.ceil(Math.sqrt(count)); 
        const numCols = Math.max(1, cols);

        const gridWidth = (numCols * itemFullSize) + ((numCols - 1) * margin);
        const surfaceWidth = surfaceEl.parentElement.clientWidth;
        
        currentOffsetX = (surfaceWidth > gridWidth) ? 
            (surfaceWidth - gridWidth) / 2 : margin;

        magnets.update(currentList => 
            currentList.map((magnet, index) => {
                const row = Math.floor(index / numCols); 
                const col = index % numCols;             
                return {
                    ...magnet,
                    size: itemFullSize, 
                    position: {
                        x: currentOffsetX + (col * gridStep),
                        y: margin + (row * gridStep)   
                    }
                };
            })
        );
        setTimeout(updateSurfaceHeight, 0);
    }
    
    function handleArrangeInRowClick() {
        currentLayoutFn = 'row';
        arrangeInRow();
        activePanel = null;
    }
    
    function handleArrangeCenteredClick() {
        currentLayoutFn = 'grid';
        arrangeInGrid();
        activePanel = null;
    }

    function handleSizeChange(event) {
        const newScale = parseFloat(event.target.value);
        editorSettings.update(s => ({ 
            ...s, 
            currentDisplayScale: newScale,
        }));
        
        magnets.update(currentList => 
            currentList.map(m => ({
                ...m,
                size: getFullMagnetSize()
            }))
        );

        if (currentLayoutFn === 'row') {
            setTimeout(arrangeInRow, 0);
        } else {
            setTimeout(arrangeInGrid, 0);
        }
    }

    function toggleBackground() {
        editorSettings.update(s => ({ ...s, isSurfaceDark: !s.isSurfaceDark }));
        activePanel = null; 
    }

    function calculateAndRenderGrid() {
        const $settings = $editorSettings;
        if ($settings.currentMode !== 'split' || !$settings.splitImageSrc) return;
        const imageRatio = $settings.splitImageRatio;
        const base = $settings.gridBaseSize;
        let cols, rows;
        if (imageRatio > 1) { 
            cols = Math.round(base * imageRatio);
            rows = base;
        } else { 
            rows = Math.round(base / imageRatio);
            cols = base;
        }
        renderSplitGrid(cols, rows);
    }

    function renderSplitGrid(cols, rows) {
        const $settings = $editorSettings;
        let newMagnets = [];
        const count = cols * rows; 
        const itemStep = BASE_MAGNET_SIZE + (BASE_MAGNET_SIZE * SPLIT_MARGIN_PERCENT);
        const margin = (BASE_MAGNET_SIZE * SPLIT_MARGIN_PERCENT);
        const gridRatio = cols / rows;
        const imageRatio = $settings.splitImageRatio;
        let bgWidth, bgHeight;
        if (imageRatio > gridRatio) {
            bgHeight = rows * 100;
            bgWidth = bgHeight * imageRatio;
        } else {
            bgWidth = cols * 100;
            bgHeight = bgWidth / imageRatio;
        }
        for (let i = 0; i < count; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const bgX = (cols > 1) ?
                (col / (cols - 1)) * 100 : 0;
            const bgY = (rows > 1) ?
                (row / (rows - 1)) * 100 : 0;
            const newX = margin + (col * itemStep);
            const newY = margin + (row * itemStep); 
            newMagnets.push({
                id: `split-tile-${row}-${col}`, 
                src: $settings.splitImageSrc,
                originalSrc: $settings.splitImageSrc, 
                isSplitPart: true,
                transform: { 
                    bgWidth: bgWidth, 
                    bgHeight: bgHeight, 
                    bgPosX: bgX, 
                    bgPosY: bgY 
                },
                position: { x: newX, y: newY },
                size: BASE_MAGNET_SIZE
            });
        }
        magnets.set(newMagnets); 
        setTimeout(updateSurfaceHeight, 0);
    }

    function incrementGrid() {
        editorSettings.update(s => ({ ...s, gridBaseSize: s.gridBaseSize + 1 }));
        calculateAndRenderGrid();
        activePanel = null; 
    }
    
    function decrementGrid() {
        if ($editorSettings.gridBaseSize > MIN_GRID_BASE) {
            editorSettings.update(s => ({ ...s, gridBaseSize: s.gridBaseSize - 1 }));
            calculateAndRenderGrid();
            activePanel = null; 
        }
    }
    
    function getEventPosition(e) {
         return e.touches ?
            e.touches[0] : e;
    }

    function onDragStart(event) {
        const { id, event: dragEvent, element: magnetEl } = event.detail;
        dragEvent.preventDefault(); 
        
        isDragging = true; 
        activeMagnetId = id;

        if (!magnetEl || !surfaceEl) return;
        
        const magnet = $magnets.find(m => m.id === id);
        if (magnet) {
            dragStartX = magnet.position.x; 
            dragStartY = magnet.position.y;
        }

        surfaceRectCache = surfaceEl.parentElement.getBoundingClientRect();
        
        const pos = getEventPosition(dragEvent);
        const rect = magnetEl.getBoundingClientRect();
        
        dragOffsetX = pos.clientX - rect.left + surfaceEl.parentElement.scrollLeft;
        dragOffsetY = pos.clientY - rect.top + surfaceEl.parentElement.scrollTop;
        
        magnetEl.classList.add('draggable');
        
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('touchend', onDragEnd);
    }

    function onDragMove(e) {
        if (activeMagnetId === null) return;
        e.preventDefault();
        
        const pos = getEventPosition(e);
        
        let newX = pos.clientX - surfaceRectCache.left + surfaceEl.parentElement.scrollLeft - dragOffsetX;
        let newY = pos.clientY - surfaceRectCache.top + surfaceEl.parentElement.scrollTop - dragOffsetY;

        if (newX < 0) newX = 0;
        if (newY < 0) newY = 0;
        
        magnets.update(list => 
            list.map(m => 
                m.id === activeMagnetId ? { ...m, position: { x: newX, y: newY } } : m
            )
        );
    }

    function onDragEnd() {
        if (activeMagnetId === null) return;
        
        isDragging = false; 
        isRepositioning = true; 

        const magnet = $magnets.find(m => m.id === activeMagnetId);
        
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);
        document.removeEventListener('touchmove', onDragMove);
        document.removeEventListener('touchend', onDragEnd);
        
        if (!magnet) {
             activeMagnetId = null;
             surfaceRectCache = null;
             isRepositioning = false;
             return;
        }

        const itemFullSize = getFullMagnetSize();
        const margin = getMargin();
        const gridStep = itemFullSize + margin; 
        
        const gridCol = Math.round((magnet.position.x - currentOffsetX) / gridStep);
        const gridRow = Math.round((magnet.position.y - margin) / gridStep);
        
        let snapX = currentOffsetX + (gridCol * gridStep); 
        let snapY = margin + (gridRow * gridStep); 

        if (snapX < margin) snapX = margin;
        if (snapY < margin) snapY = margin;

        const collision = $magnets.some(m => {
                if (m.id === activeMagnetId) return false; 
                const x1_left = snapX;
                const x1_right = snapX + itemFullSize;
                const y1_top = snapY;
                const y1_bottom = snapY + itemFullSize;
                
                const x2_left = m.position.x;
                const x2_right = m.position.x + m.size;
                const y2_top = m.position.y;
                const y2_bottom = m.position.y + m.size;

                const isOverlapping = (
                    x1_left < x2_right &&
                    x1_right > x2_left &&
                    y1_top < y2_bottom &&
                    y1_bottom > y2_top
                );
                
                return isOverlapping;
            });

        if (collision) {
             snapX = dragStartX;
             snapY = dragStartY;
        }

        magnets.update(list => 
            list.map(m => 
                m.id === activeMagnetId ? { ...m, position: { x: snapX, y: snapY } } : m
            )
        );
        
        const magnetEl = surfaceEl.querySelector(`[data-id="${activeMagnetId}"]`);
        if (magnetEl) {
            magnetEl.classList.remove('draggable');
        }

        activeMagnetId = null;
        surfaceRectCache = null; 
        
        setTimeout(updateSurfaceHeight, 550);

        setTimeout(() => {
            isRepositioning = false; 
        }, 100); 
    }
    
    function deleteMagnetFromStore(event) {
        magnets.update(list => list.filter(m => m.id !== event.detail.id));
        setTimeout(updateSurfaceHeight, 0);
    }

</script>

<svelte:window on:resize={handleResize}/>

<div class="canvas-container" class:container-dark={$editorSettings.isSurfaceDark}>
    <div 
        id="configurator-surface" 
        bind:this={surfaceEl} 
        style="min-height: {$editorSettings.surfaceMinHeight};"
        class:surface-dark={$editorSettings.isSurfaceDark}
    >
        {#if $editorSettings.currentMode === 'multi'}
            {#each $magnets as magnet (magnet.id)}
                <Magnet 
                    {...magnet} 
                    activeEffectId={magnet.activeEffectId}
                    isSplitPart={false}
                    on:delete={deleteMagnetFromStore}
                    on:dragstart={onDragStart}
                />
            {/each}
        {:else}
            {#each $magnets as magnet (magnet.id)}
                <Magnet 
                    {...magnet}
                    isSplitPart={true}
                    on:delete={deleteMagnetFromStore}
                />
            {/each}
        {/if}

    </div>
        
    {#if $magnets.length === 0 && !$editorSettings.splitImageSrc}
    <div id="initial-upload-prompt">
        <button 
            id="initial-upload-btn" 
            on:click={() => $editorSettings.currentMode === 'multi' ?
                multiUploadInput.click() : splitUploadInput.click()}
        >
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


{#if $editorSettings.currentMode === 'multi'}
    <footer class="bottom-toolbar" class:controls-active={$magnets.length > 0}>
        <button class="toolbar-btn" on:click={handleArrangeCenteredClick}>סידור אוט'</button>
        <button class="toolbar-btn" on:click={handleArrangeInRowClick}>סידור שורה</button>
        <button class="toolbar-btn" on:click={() => togglePanel('size')}>גודל תצוגה</button>
        <button class="toolbar-btn" on:click={() => togglePanel('effects')}>אפקטים</button>
        <button class="toolbar-btn" on:click={toggleBackground}>החלף רקע</button> 
        <button class="toolbar-add-btn" on:click={() => { multiUploadInput.click();
            activePanel = null; }}>+</button>
    </footer>
{/if}

{#if $editorSettings.currentMode === 'split'}
    <footer class="bottom-toolbar" class:controls-active={$editorSettings.splitImageSrc !== null}>
         <button class="toolbar-btn" on:click={() => { splitUploadInput.click();
            activePanel = null; }}>החלף תמונה</button>
         <button class="toolbar-btn" on:click={toggleBackground}>החלף רקע</button>
         <button class="toolbar-btn" on:click={() => togglePanel('effects')}>אפקטים</button> 
         <div class="split-controls-group"> 
             <button class="split-btn" on:click={decrementGrid} disabled={$editorSettings.gridBaseSize <= MIN_GRID_BASE}>-</button>
             <span id="split-grid-display">גודל רשת</span>
             <button class="split-btn" on:click={incrementGrid}>+</button>
         </div>
    </footer>
{/if}

<input 
    type="file" 
    id="multi-image-upload" 
    multiple 
    accept="image/*" 
    style="display: none;"
    bind:this={multiUploadInput}
    on:change={handleMultiUpload}
>
<input 
    type="file" 
    id="split-image-upload" 
    accept="image/*" 
    style="display: none;"
    bind:this={splitUploadInput}
    on:change={handleSplitUpload}
>

<FloatingPanel 
    title="גודל תצוגה" 
    isOpen={activePanel === 'size'} 
    on:close={() => activePanel = null}
>
    <div class="size-slider-container">
        <span>-</span>
        <input 
            type="range" 
            id="size-slider" 
            min="0.5" 
            max="3"
            value={$editorSettings.currentDisplayScale}
            step="0.1"
            on:input={handleSizeChange}
        >
        <span>+</span>
    </div>
</FloatingPanel>

<FloatingPanel 
    title="בחר אפקט" 
    isOpen={activePanel === 'effects'} 
    on:close={() => activePanel = null}
>
    <div class="effects-list">
        {#each effectsList as effect (effect.id)}
            <button 
                class="effect-select-btn"
                class:active={effect.id === $editorSettings.currentEffect}
                on:click={() => applyEffectToAllMagnets(effect.id)}
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

<div class="loader-wrapper" id="loader" bind:this={loaderEl} style="display: none;">
    <div class="loader-text">FEEL</div>
</div>