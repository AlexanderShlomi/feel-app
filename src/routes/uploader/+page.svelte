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
        getFullMagnetSize, 
        getMargin,
        BASE_MAGNET_SIZE, 
        SPLIT_MARGIN_PERCENT,
        MIN_GRID_BASE
    } from '$lib/stores.js';

    // --- רשימת אפקטים ---
    const effectsList = [
        { id: 'original', name: 'מקורי', filter: 'none' },
        { id: 'silver', name: 'כסף', filter: 'grayscale(100%)' },
        { id: 'noir', name: 'נואר', filter: 'grayscale(100%) contrast(1.3) brightness(0.9)' },
        { id: 'vivid', name: 'עז', filter: 'saturate(180%) contrast(110%)' },
        { id: 'dramatic', name: 'דרמטי', filter: 'contrast(140%) sepia(20%)' }
    ];

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
    let activeMagnetEl = null; 
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    
    // --- אובייקטים ב-DOM ---
    let surfaceEl; 
    let multiUploadInput; 
    let splitUploadInput; 
    let loaderEl; 
    
    let resizeObserver;

    // --- פונקציות לוגיות ---
    
    function handleMultiUpload(event) {
        const files = event.target.files;
        if (files.length === 0) return;
        
        loaderEl.style.display = 'flex';
        
        addUploadedMagnets(files);
        
        setTimeout(() => {
            loaderEl.style.display = 'none';
            arrangeInGrid(); // קורא לסידור "מרכז מסה" הראשוני
        }, 500);
    }
    
    function handleSplitUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        loaderEl.style.display = 'flex';

        const reader = new FileReader();
        reader.onload = (e) => {
            const newSplitSrc = e.target.result;
            editorSettings.update(s => ({ ...s, splitImageSrc: newSplitSrc }));
            
            const img = new Image();
            img.onload = () => {
                const ratio = img.naturalWidth / img.naturalHeight;
                
                editorSettings.update(s => ({ 
                    ...s, 
                    splitImageRatio: ratio,
                    gridBaseSize: MIN_GRID_BASE // איפוס לגודל האופטימלי
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

    /**
     * פונקציית סידור רספונסיבית.
     * פועלת אוטומטית בשינוי גודל מסך או סליידר.
     */
    function layoutResponsive() {
        const count = $magnets.length;
        if (count === 0 || $editorSettings.currentMode !== 'multi' || !surfaceEl) { 
            updateSurfaceHeight();
            return;
        }

        const itemFullSize = getFullMagnetSize();
        const margin = getMargin();
        const gridStep = itemFullSize + margin;
        
        const surfaceWidth = surfaceEl.parentElement.clientWidth; 
        const cols = Math.floor((surfaceWidth - margin) / gridStep); 
        const numCols = Math.max(1, cols); 

        magnets.update(currentList => 
            currentList.map((magnet, index) => {
                const row = Math.floor(index / numCols); 
                const col = index % numCols;             
                return {
                    ...magnet,
                    position: {
                        x: margin + (col * gridStep),
                        y: margin + (row * gridStep)
                    }
                };
            })
        );
        
        setTimeout(updateSurfaceHeight, 0);
    }

    /**
     * פונקציית "סידור אוט'" (מרכז מסה).
     * נקראת רק מהכפתור. יוצרת גריד ריבועי וממרכזת אותו.
     */
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
        
        const offsetX = Math.max(margin, (surfaceWidth - gridWidth) / 2);

        magnets.update(currentList => 
            currentList.map((magnet, index) => {
                const row = Math.floor(index / numCols); 
                const col = index % numCols;             
                return {
                    ...magnet,
                    position: {
                        x: offsetX + (col * gridStep), 
                        y: margin + (row * gridStep)   
                    }
                };
            })
        );
        
        setTimeout(updateSurfaceHeight, 0);
        activePanel = null; // סוגר פאנלים פתוחים
    }
    
    function arrangeInRow() {
        if ($magnets.length === 0 || $editorSettings.currentMode !== 'multi' || !surfaceEl) {
            updateSurfaceHeight();
            return;
        }
        
        const surfaceWidth = surfaceEl.parentElement.clientWidth;
        const itemFullSize = getFullMagnetSize();
        const margin = getMargin();
        const gridStep = itemFullSize + margin;

        let newX = margin;
        let newY = margin;
        
        magnets.update(currentList => 
            currentList.map((magnet, index) => {
                if (newX + itemFullSize > surfaceWidth - margin && index > 0) {
                    newX = margin;
                    newY += gridStep;
                }
                let pos = { x: newX, y: newY };
                newX += gridStep;
                return { ...magnet, position: pos };
            })
        );

        setTimeout(updateSurfaceHeight, 0);
        activePanel = null; 
    }

    function handleSizeChange(event) {
        const newScale = parseFloat(event.target.value);
        editorSettings.update(s => ({ ...s, currentDisplayScale: newScale }));
        
        magnets.update(currentList => 
            currentList.map(m => ({
                ...m,
                size: getFullMagnetSize()
            }))
        );
        
        setTimeout(layoutResponsive, 0); 
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
            const bgX = (cols > 1) ? (col / (cols - 1)) * 100 : 0;
            const bgY = (rows > 1) ? (row / (rows - 1)) * 100 : 0;
            
            const newX = margin + (col * itemStep); 
            const newY = margin + (row * itemStep); 

            newMagnets.push({
                id: `split-tile-${row}-${col}`, 
                src: $settings.splitImageSrc,
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

    // --- לוגיקת גרירה (מהירה) ---
    
    function getEventPosition(e) {
         return e.touches ? e.touches[0] : e;
    }

    function onDragStart(event) {
        const { id, event: dragEvent, element: magnetEl } = event.detail;
        dragEvent.preventDefault(); 
        
        activeMagnetId = id;
        activeMagnetEl = magnetEl; 
        if (!activeMagnetEl) return;
        
        const pos = getEventPosition(dragEvent);
        const rect = activeMagnetEl.getBoundingClientRect(); 
        
        dragOffsetX = pos.clientX - rect.left + surfaceEl.parentElement.scrollLeft;
        dragOffsetY = pos.clientY - rect.top + surfaceEl.parentElement.scrollTop;

        activeMagnetEl.classList.add('draggable'); 
        
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('touchend', onDragEnd);
    }

    function onDragMove(e) {
        if (activeMagnetId === null) return;
        e.preventDefault();
        
        const pos = getEventPosition(e);
        const rect = surfaceEl.parentElement.getBoundingClientRect(); 
        const margin = getMargin();

        let newX = pos.clientX - rect.left + surfaceEl.parentElement.scrollLeft - dragOffsetX;
        let newY = pos.clientY - rect.top + surfaceEl.parentElement.scrollTop - dragOffsetY;

        if (newX < margin) newX = margin;
        if (newY < margin) newY = margin;
        
        if (activeMagnetEl) {
            activeMagnetEl.style.left = `${newX}px`;
            activeMagnetEl.style.top = `${newY}px`;
        }
    }

    function onDragEnd() {
        if (activeMagnetId === null) return;
        
        let currentX = parseFloat(activeMagnetEl.style.left);
        let currentY = parseFloat(activeMagnetEl.style.top);

        const itemFullSize = getFullMagnetSize();
        const margin = getMargin();
        const gridStep = itemFullSize + margin; 
        
        const surfaceWidth = surfaceEl.parentElement.clientWidth; 
        const cols = Math.floor((surfaceWidth - margin) / gridStep); 
        const numCols = Math.max(1, cols);
        
        const gridCol = Math.round((currentX - margin) / gridStep);
        const snappedCol = Math.max(0, Math.min(gridCol, numCols - 1));

        const gridRow = Math.round((currentY - margin) / gridStep);
        const snappedRow = Math.max(0, gridRow);
        
        let snapX = margin + (snappedCol * gridStep); 
        let snapY = margin + (snappedRow * gridStep); 

        if (activeMagnetEl) {
             activeMagnetEl.classList.remove('draggable');
        }

        magnets.update(list => 
            list.map(m => 
                m.id === activeMagnetId ? { ...m, position: { x: snapX, y: snapY } } : m
            )
        );
        
        if (activeMagnetEl) {
            activeMagnetEl.style.left = '';
            activeMagnetEl.style.top = '';
        }

        activeMagnetId = null;
        activeMagnetEl = null; 
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);
        document.removeEventListener('touchmove', onDragMove);
        document.removeEventListener('touchend', onDragEnd);
        
        setTimeout(updateSurfaceHeight, 550); 
    }
    
    function deleteMagnetFromStore(event) {
        magnets.update(list => list.filter(m => m.id !== event.detail.id));
        setTimeout(updateSurfaceHeight, 0);
    }

    onMount(() => {
        resizeObserver = new ResizeObserver(() => {
            if ($editorSettings.currentMode === 'multi') {
                layoutResponsive(); 
            }
        });

        if (surfaceEl && surfaceEl.parentElement) {
            resizeObserver.observe(surfaceEl.parentElement);
        }

        setTimeout(() => {
            if ($editorSettings.currentMode === 'multi') {
                arrangeInGrid(); // סידור "מרכז מסה" ראשוני
            } else if ($editorSettings.splitImageSrc) { 
                calculateAndRenderGrid();
            }
        }, 0); 
    });

    onDestroy(() => {
        if (resizeObserver && surfaceEl && surfaceEl.parentElement) {
            resizeObserver.unobserve(surfaceEl.parentElement);
        }
    });

</script>

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
                    id={magnet.id}
                    src={magnet.src}
                    originalSrc={magnet.originalSrc}
                    transform={magnet.transform}
                    position={magnet.position}
                    size={magnet.size}
                    isSplitPart={false}
                    on:delete={deleteMagnetFromStore}
                    on:dragstart={onDragStart}
                />
            {/each}
        {:else}
            {#each $magnets as magnet (magnet.id)}
                <Magnet 
                    id={magnet.id}
                    src={magnet.src}
                    transform={magnet.transform}
                    position={magnet.position}
                    size={magnet.size}
                    isSplitPart={true}
                />
            {/each}
        {/if}

    </div>
        
    {#if $magnets.length === 0 && !$editorSettings.splitImageSrc}
    <div id="initial-upload-prompt">
        <button 
            id="initial-upload-btn" 
            on:click={() => $editorSettings.currentMode === 'multi' ? multiUploadInput.click() : splitUploadInput.click()}
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
        <button class="toolbar-btn" on:click={arrangeInGrid}>סידור אוט'</button>
        <button class="toolbar-btn" on:click={arrangeInRow}>סידור שורה</button>
        <button class="toolbar-btn" on:click={() => togglePanel('size')}>גודל תצוגה</button>
        <button class="toolbar-btn" on:click={() => togglePanel('effects')}>אפקטים</button>
        <button class="toolbar-btn" on:click={toggleBackground}>החלף רקע</button> 
        <button class="toolbar-add-btn" on:click={() => { multiUploadInput.click(); activePanel = null; }}>+</button>
    </footer>
{/if}

{#if $editorSettings.currentMode === 'split'}
    <footer class="bottom-toolbar" class:controls-active={$editorSettings.splitImageSrc !== null}>
         <button class="toolbar-btn" on:click={() => { splitUploadInput.click(); activePanel = null; }}>החלף תמונה</button>
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
            min="0.5" max="3" 
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
                on:click={() => editorSettings.update(s => ({ ...s, currentEffect: effect.id }))}
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
