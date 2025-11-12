<svelte:head>
    <title>FEEL - עורך המגנטים</title>
</svelte:head>

<script>
    import { onMount } from 'svelte';
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

    // --- משתני פאנלים ---
    let showSizePanel = false;
    let showEffectsPanel = false;
    
    // --- משתני גרירה ---
    let activeMagnetId = null;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    
    // --- אובייקטים ב-DOM ---
    let surfaceEl; // ייקשר למשטח העבודה
    let multiUploadInput; // ייקשר לכפתור העלאה
    let splitUploadInput; // ייקשר לכפתור העלאה
    let loaderEl; // ייקשר ללואדר

    // --- פונקציות לוגיות ---
    
    function handleMultiUpload(event) {
        const files = event.target.files;
        if (files.length === 0) return;
        
        loaderEl.style.display = 'flex';
        
        addUploadedMagnets(files);
        
        setTimeout(() => {
            loaderEl.style.display = 'none';
            arrangeInGrid();
            // checkMinImages();
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
                editorSettings.update(s => ({ ...s, splitImageRatio: ratio }));
                calculateAndRenderGrid(); 
                loaderEl.style.display = 'none';
            };
            img.src = newSplitSrc;
        };
        reader.readAsDataURL(file);
    }
    
    function updateSurfaceHeight() {
        if (!surfaceEl) return;
        
        let items = $magnets; // קריאה מה-store
        let margin = ($editorSettings.currentMode === 'multi') ? getMargin() : (BASE_MAGNET_SIZE * SPLIT_MARGIN_PERCENT);
        
        if (items.length === 0) {
            editorSettings.update(s => ({ ...s, surfaceMinHeight: '100%' }));
            return;
        }

        let maxBottom = 0;
        items.forEach(item => {
            // הוספת בדיקה שהמיקום קיים
            if (item.position.y > -9000) {
                const bottomPosition = item.position.y + item.size;
                if (bottomPosition > maxBottom) {
                    maxBottom = bottomPosition;
                }
            }
        });

        const totalHeight = maxBottom + margin;
        // --- תיקון: הגובה המינימלי הוא 100% *רק* אם התוכן קטן יותר ---
        const containerHeight = surfaceEl.parentElement.clientHeight;
        editorSettings.update(s => ({ ...s, surfaceMinHeight: `${Math.max(totalHeight, containerHeight)}px` }));
    }

    function arrangeInGrid() {
        const count = $magnets.length;
        if (count === 0 || $editorSettings.currentMode !== 'multi') {
            updateSurfaceHeight();
            return;
        }

        const itemFullSize = getFullMagnetSize();
        const margin = getMargin();
        const gridStep = itemFullSize + margin;
        const cols = Math.ceil(Math.sqrt(count));

        magnets.update(currentList => 
            currentList.map((magnet, index) => {
                const row = Math.floor(index / cols);
                const col = index % cols;
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
    
    function arrangeInRow() {
        if ($magnets.length === 0 || $editorSettings.currentMode !== 'multi' || !surfaceEl) {
            updateSurfaceHeight();
            return;
        }
        
        const surfaceWidth = surfaceEl.clientWidth;
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
        
        setTimeout(arrangeInGrid, 0); 
    }

    function toggleBackground() {
        editorSettings.update(s => ({ ...s, isSurfaceDark: !s.isSurfaceDark }));
    }
    
    // --- לוגיקת פסיפס (שהייתה חסרה) ---
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
                id: crypto.randomUUID(),
                src: $settings.splitImageSrc, // מקור התמונה הוא התמונה הגדולה
                isSplitPart: true,
                transform: { 
                    bgWidth: bgWidth, 
                    bgHeight: bgHeight, 
                    bgPosX: bgX, 
                    bgPosY: bgY 
                },
                position: { x: newX, y: newY },
                size: BASE_MAGNET_SIZE // גודל קבוע לפסיפס
            });
        }
        
        magnets.set(newMagnets); // החלפה מלאה של המערך
        setTimeout(updateSurfaceHeight, 0);
    }

    function incrementGrid() {
        editorSettings.update(s => ({ ...s, gridBaseSize: s.gridBaseSize + 1 }));
        calculateAndRenderGrid();
    }
    
    function decrementGrid() {
        if ($editorSettings.gridBaseSize > MIN_GRID_BASE) {
            editorSettings.update(s => ({ ...s, gridBaseSize: s.gridBaseSize - 1 }));
            calculateAndRenderGrid();
        }
    }

    // --- לוגיקת גרירה ---
    
    function getEventPosition(e) {
         return e.touches ? e.touches[0] : e;
    }

    function onDragStart(event) {
        const { id, event: dragEvent, element: magnetEl } = event.detail;
        dragEvent.preventDefault(); 
        
        activeMagnetId = id;
        if (!magnetEl) return;
        
        const pos = getEventPosition(dragEvent);
        const rect = magnetEl.getBoundingClientRect();
        
        // --- תיקון: חישוב אופסט ביחס לקונטיינר הגולל ---
        dragOffsetX = pos.clientX - rect.left + surfaceEl.parentElement.scrollLeft;
        dragOffsetY = pos.clientY - rect.top + surfaceEl.parentElement.scrollTop;

        // הוספת קלאס 'draggable' לאלמנט ה-DOM
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
        const rect = surfaceEl.parentElement.getBoundingClientRect(); 
        const margin = getMargin();

        // --- תיקון: חישוב מיקום ביחס לקונטיינר הגולל ---
        let newX = pos.clientX - rect.left + surfaceEl.parentElement.scrollLeft - dragOffsetX;
        let newY = pos.clientY - rect.top + surfaceEl.parentElement.scrollTop - dragOffsetY;

        if (newX < margin) newX = margin;
        if (newY < margin) newY = margin;
        
        magnets.update(list => 
            list.map(m => 
                m.id === activeMagnetId ? { ...m, position: { x: newX, y: newY } } : m
            )
        );
    }

    function onDragEnd() {
        if (activeMagnetId === null) return;
        
        const magnet = $magnets.find(m => m.id === activeMagnetId);
        if (!magnet) return;

        // הצמדה לרשת
        const itemFullSize = getFullMagnetSize();
        const margin = getMargin();
        const gridStep = itemFullSize + margin; 
        
        const gridCol = Math.round((magnet.position.x - margin) / gridStep);
        const gridRow = Math.round((magnet.position.y - margin) / gridStep);
        
        let snapX = margin + (gridCol * gridStep); 
        let snapY = margin + (gridRow * gridStep); 

        if (snapX < margin) snapX = margin;
        if (snapY < margin) snapY = margin;

        // מציאת אלמנט ה-DOM והסרת הקלאס
        const magnetEl = surfaceEl.querySelector(`[data-id="${activeMagnetId}"]`);
        if (magnetEl) {
             magnetEl.classList.remove('draggable');
        }

        magnets.update(list => 
            list.map(m => 
                m.id === activeMagnetId ? { ...m, position: { x: snapX, y: snapY } } : m
            )
        );
        
        activeMagnetId = null;
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);
        document.removeEventListener('touchmove', onDragMove);
        document.removeEventListener('touchend', onDragEnd);
        
        setTimeout(updateSurfaceHeight, 550); // עדכון גובה אחרי סיום אנימציה
    }
    
    function deleteMagnetFromStore(event) {
        magnets.update(list => list.filter(m => m.id !== event.detail.id));
        setTimeout(updateSurfaceHeight, 0);
    }

    // וידוא שהגדרות ראשוניות נטענות
    onMount(() => {
        if ($editorSettings.currentMode === 'multi') {
            arrangeInGrid();
        } else if ($editorSettings.splitImageSrc) { // רק אם יש תמונת פסיפס בזיכרון
            calculateAndRenderGrid();
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
                    on:delete={deleteMagnetFromStore}
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
        <button class="toolbar-btn" on:click={() => showSizePanel = true}>גודל תצוגה</button>
        <button class="toolbar-btn" on:click={() => showEffectsPanel = true}>אפקטים</button>
        <button class="toolbar-btn" on:click={toggleBackground}>החלף רקע</button> 
        <button class="toolbar-add-btn" on:click={() => multiUploadInput.click()}>+</button>
    </footer>
{/if}

{#if $editorSettings.currentMode === 'split'}
    <footer class="bottom-toolbar" class:controls-active={$editorSettings.splitImageSrc !== null}>
         <button class="toolbar-btn" on:click={() => splitUploadInput.click()}>החלף תמונה</button>
         <button class="toolbar-btn" on:click={toggleBackground}>החלף רקע</button>
         <button class="toolbar-btn" on:click={() => showEffectsPanel = true}>אפקטים</button> 
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

<FloatingPanel title="גודל תצוגה" bind:isOpen={showSizePanel} on:close={() => showSizePanel = false}>
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

<FloatingPanel title="אפקטים" bind:isOpen={showEffectsPanel} on:close={() => showEffectsPanel = false}>
    <div class="effects-list">
        <button class="effect-select-btn" data-effect="original">
            <img src="https://via.placeholder.com/80x80/eee/aaa?text=FEEL" alt="Original">
            Original
        </button>
        <button class="effect-select-btn" data-effect="silver">
            <img src="https://via.placeholder.com/80x80/eee/aaa?text=FEEL" alt="Silver">
            Silver
        </button>
    </div>
</FloatingPanel>

<div class="loader-wrapper" id="loader" bind:this={loaderEl} style="display: none;">
    <div class="loader-text">FEEL</div>
</div>