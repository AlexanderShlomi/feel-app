<script>
    import { onMount, onDestroy, tick } from 'svelte';
    import { fade } from 'svelte/transition';
    import Magnet from '$lib/components/Magnet.svelte';
    import FloatingPanel from '$lib/components/FloatingPanel.svelte';
    import FileUploader from '$lib/components/FileUploader.svelte';
    import MosaicEditor from '$lib/components/MosaicEditor.svelte';
    import GiftButton from '$lib/components/GiftButton.svelte'; 
    import UpsellWidget from '$lib/components/UpsellWidget.svelte';
    
    import { draggable } from '$lib/actions/draggable.js';
    import { findBestTargetSlot, reflowMagnets, placeNewMagnets } from '$lib/utils/grid.js';
    import { resetSystem } from '$lib/stores.js';
    import { goto } from '$app/navigation';
    
    import { 
        magnets, 
        editorSettings, 
        isMobile,
        addUploadedMagnets,
        updateMagnetProcessedSrc, 
        getFullMagnetSize, 
        getMargin,
        saveWorkspaceToCart,
        PRODUCT_TYPES,        
        BASE_MAGNET_SIZE, 
        SPLIT_MAGNET_SIZE,        
        SPLIT_MARGIN_PERCENT, 
        MIN_GRID_BASE,
        SCALE_MIN,        
        SCALE_MAX,          
        SCALE_DEFAULT,
        PACKAGES  
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
    let lastSurfaceWidth = 0;
    
    let isSplitEditing = false; 
    $: isGiftMode = $editorSettings.currentProductType === PRODUCT_TYPES.GIFT;
    
    $: splitGridInfo = (() => {
        const ratio = $editorSettings.splitImageRatio;
        const base = $editorSettings.gridBaseSize;
        let c, r;
        if (ratio > 1) { c = Math.round(base * ratio); r = base; } 
        else { r = Math.round(base / ratio); c = base; }
        return { cols: c, rows: r, total: c * r };
    })();
    
    $: canAddToCartMosaic = !!$editorSettings.splitImageSrc;

    onMount(() => {
        // #region agent log
        fetch('http://127.0.0.1:7673/ingest/3221cbc6-40ae-4c77-a825-a11fe005892b', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Debug-Session-Id': '06a31e'
            },
            body: JSON.stringify({
                sessionId: '06a31e',
                runId: 'initial',
                hypothesisId: 'LOG1',
                location: 'src/routes/uploader/+page.svelte:onMount',
                message: 'uploader page mounted',
                data: {
                    path: typeof window !== 'undefined' ? window.location.pathname : null
                },
                timestamp: Date.now()
            })
        }).catch(() => {});
        // #endregion agent log

        window.addEventListener('dragstart', (e) => e.preventDefault());
        window.addEventListener('resize', handleResize);
        
        // פתיחת מתנה אוטומטית אם צריך
        setTimeout(() => {
            if ($editorSettings.currentProductType === PRODUCT_TYPES.GIFT) {
                const giftBtn = document.querySelector('.gift-btn');
                if (giftBtn) giftBtn.click();
            }
        }, 300);

        let currentScale = $editorSettings.currentDisplayScale;
        if (!currentScale || currentScale < SCALE_MIN || currentScale > SCALE_MAX) {
            editorSettings.update(s => ({ ...s, currentDisplayScale: SCALE_DEFAULT }));
        }

        if (window.Worker) {
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
                        if (loaderEl) loaderEl.style.display = 'none';
                    } else {
                        updateMagnetProcessedSrc(magnetId, effectId, newSrc);
                    }
                }
            };
        }

        resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const newWidth = entry.contentRect.width;
            
            // מניעת חישובים מיותרים אם השינוי זניח (למשל גלילה שמשנה גובה במובייל)
            if (Math.abs(newWidth - lastSurfaceWidth) < 2) return; 
            
            lastSurfaceWidth = newWidth;
            if ($editorSettings.currentProductType === PRODUCT_TYPES.MAGNETS_PACK) {
                handleReflow();
            }
        });

        if (surfaceEl && surfaceEl.parentElement) {
            lastSurfaceWidth = surfaceEl.parentElement.clientWidth;
            resizeObserver.observe(surfaceEl.parentElement);
        }

        setTimeout(() => {
            if ($editorSettings.currentProductType === PRODUCT_TYPES.MAGNETS_PACK) {
                const savedScale = $editorSettings.currentDisplayScale || SCALE_DEFAULT;
                const newSize = BASE_MAGNET_SIZE * savedScale;
                magnets.update(list => list.map(m => ({ ...m, size: newSize })));
                
                if (!$isMobile && $magnets.length > 0 && (!$magnets[0].position || $magnets[0].position.x === 0)) {
                    fillEmptySlots();
                } else {
                    updateSurfaceHeight();
                }
            } else if ($editorSettings.splitImageSrc) { 
                calculateAndRenderSplitGrid();
            }
        }, 100);
        
        return () => {
             window.removeEventListener('resize', handleResize);
        }
    });

    onDestroy(() => {
        if (effectsWorker) effectsWorker.terminate();
        if (resizeObserver && surfaceEl && surfaceEl.parentElement) resizeObserver.unobserve(surfaceEl.parentElement);
    });
    
    function handleResize() {
        if ($isMobile && $editorSettings.currentProductType === PRODUCT_TYPES.MOSAIC) {
            calculateAndRenderSplitGrid();
        }
    }

    function handleReflow() {
        // במובייל אנחנו ב-Grid CSS, אז לא צריך לחשב מיקומים ב-JS
        if ($isMobile && $editorSettings.currentProductType === PRODUCT_TYPES.MAGNETS_PACK) {
             updateSurfaceHeight();
             return;
        }
        
        if ($magnets.length === 0 || $editorSettings.currentProductType !== PRODUCT_TYPES.MAGNETS_PACK || !surfaceEl) {
            updateSurfaceHeight();
            return;
        }

        const surfaceWidth = surfaceEl.parentElement.clientWidth;
        const itemFullSize = getFullMagnetSize();
        const margin = getMargin();
        
        const newLayout = reflowMagnets($magnets, surfaceWidth, itemFullSize, margin);
        magnets.set(newLayout);
        
        setTimeout(updateSurfaceHeight, 0);
    }

    function fillEmptySlots() {
        if (!surfaceEl || $isMobile) return;
        const surfaceWidth = surfaceEl.parentElement.clientWidth;
        const itemFullSize = getFullMagnetSize(); 
        const margin = getMargin();
        
        const newLayout = placeNewMagnets($magnets, surfaceWidth, itemFullSize, margin);
        magnets.set(newLayout);
        
        setTimeout(updateSurfaceHeight, 0);
    }

    function updateSurfaceHeight() {
        if (!surfaceEl) return;
        let items = $magnets; 
        let margin = ($editorSettings.currentProductType === PRODUCT_TYPES.MAGNETS_PACK) ? getMargin() : 50;

        if (items.length === 0) {
            editorSettings.update(s => ({ ...s, surfaceMinHeight: '100%' }));
            return;
        }

        if ($isMobile && $editorSettings.currentProductType === PRODUCT_TYPES.MAGNETS_PACK) {
            // חישוב גובה משוער לגריד במובייל
            const rows = Math.ceil(items.length / 2);
            const approxRowHeight = (window.innerWidth / 2) + 16; 
            const totalHeight = (rows * approxRowHeight) + 100;
            editorSettings.update(s => ({ ...s, surfaceMinHeight: `${totalHeight}px` }));
        } else {
            let maxBottom = 0;
            items.forEach(item => {
                const bottomPosition = item.position.y + item.size;
                if (bottomPosition > maxBottom) maxBottom = bottomPosition;
            });
            const totalHeight = maxBottom + margin;
            const containerHeight = surfaceEl.parentElement.clientHeight;
            editorSettings.update(s => ({ ...s, surfaceMinHeight: `${Math.max(totalHeight, containerHeight)}px` }));
        }
    }

    function onMagnetDragEnd(event) {
        if ($isMobile) return; // הגנה נוספת
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
            snapX = x; snapY = y;
        }

        magnets.update(list => list.map(m => m.id === id ? { ...m, position: { x: snapX, y: snapY } } : m));
        setTimeout(updateSurfaceHeight, 300);
    }

    function triggerUploadAction() {
        const elementId = $editorSettings.currentProductType === PRODUCT_TYPES.MAGNETS_PACK ? 'upload-multi-input' : 'upload-split-input';
        const el = document.getElementById(elementId);
        if (el) el.click();
    }

    async function onMultiFilesSelected(event) {
        const files = event.detail;
        if (!files || files.length === 0) return;
        loaderEl.style.display = 'block'; 
        
        await addUploadedMagnets(files);
        
        const currentScale = $editorSettings.currentDisplayScale || SCALE_DEFAULT;
        const targetSize = BASE_MAGNET_SIZE * currentScale;
        
        magnets.update(list => list.map(m => ({ ...m, size: targetSize })));
        loaderEl.style.display = 'none';
        
        if (!$isMobile) fillEmptySlots();
        else updateSurfaceHeight();
    }
    
    function onSplitImageLoaded(event) {
        const { src, ratio } = event.detail;
        loaderEl.style.display = 'block';
        
        editorSettings.update(s => ({ 
            ...s, 
            splitImageSrc: src,
            splitImageRatio: ratio,
            gridBaseSize: MIN_GRID_BASE,
            currentEffect: 'original',
            splitTransform: { zoom: 1, x: 0, y: 0, xPct: 0, yPct: 0 },
            splitImageCache: { original: null, silver: null, noir: null, vivid: null, dramatic: null },
            surfaceMinHeight: '0px' 
        }));

        setTimeout(() => {
            calculateAndRenderSplitGrid(); 
        }, 50); 
    }

    let splitRenderFrame;
    function calculateAndRenderSplitGrid() {
        if (splitRenderFrame) cancelAnimationFrame(splitRenderFrame);
        if (loaderEl) loaderEl.style.display = 'block';

        splitRenderFrame = requestAnimationFrame(() => {
            const $settings = $editorSettings;
            if ($settings.currentProductType !== PRODUCT_TYPES.MOSAIC || !$settings.splitImageSrc) {
                if (loaderEl) loaderEl.style.display = 'none';
                return;
            }

            const imageRatio = $settings.splitImageRatio;
            const base = $settings.gridBaseSize;
            let cols, rows;

            if (imageRatio > 1) { cols = Math.round(base * imageRatio); rows = base; } 
            else { rows = Math.round(base / imageRatio); cols = base; }

            let size, gap;
            
            if ($isMobile) {
                gap = 2; 
                const totalScreenWidth = window.innerWidth;
                size = (totalScreenWidth - ((cols - 1) * gap)) / cols;
            } else {
                const marginX = 20; 
                const marginTop = 50; 
                const marginBottom = 140; 
                
                const availableWidth = window.innerWidth - (marginX * 2);
                const availableHeight = window.innerHeight - (marginTop + marginBottom);
                
                const gapRatio = SPLIT_MARGIN_PERCENT;
                const safetyFactor = 0.96; 
                const sizeByWidth = (availableWidth * safetyFactor) / (cols + ((cols - 1) * gapRatio));
                const sizeByHeight = (availableHeight * safetyFactor) / (rows + ((rows - 1) * gapRatio));
                
                size = Math.min(SPLIT_MAGNET_SIZE, sizeByWidth, sizeByHeight);
                gap = size * gapRatio;
            }

            const step = size + gap;
            const count = cols * rows;
            const totalGridWidth = (cols * size) + ((cols - 1) * gap);
            const totalGridHeight = (rows * size) + ((rows - 1) * gap);
            
            if (surfaceEl) {
                if (!$isMobile) {
                    surfaceEl.style.width = `${totalGridWidth}px`;
                    surfaceEl.style.height = `${totalGridHeight}px`;
                    editorSettings.update(s => ({...s, surfaceMinHeight: '0px'}));
                } else {
                    surfaceEl.style.width = '';
                    surfaceEl.style.height = '';
                    const h = (rows * step) - gap;
                    editorSettings.update(s => ({...s, surfaceMinHeight: `${h}px`}));
                }
            }

            let bgWidth, bgHeight;
            if (imageRatio > (totalGridWidth / totalGridHeight)) {
                bgHeight = Math.ceil(totalGridHeight) + 2; bgWidth = Math.ceil(bgHeight * imageRatio);
            } else {
                bgWidth = Math.ceil(totalGridWidth) + 2; bgHeight = Math.ceil(bgWidth / imageRatio);
            }

            const userTransform = $settings.splitTransform || { zoom: 1, x: 0, y: 0, xPct: 0, yPct: 0 };
            const finalBgWidth = bgWidth * userTransform.zoom;
            const finalBgHeight = bgHeight * userTransform.zoom;
            
            const shiftX = (userTransform.xPct || 0) * finalBgWidth;
            const shiftY = (userTransform.yPct || 0) * finalBgHeight;
            
            const startX = (totalGridWidth - finalBgWidth) / 2 + shiftX;
            const startY = (totalGridHeight - finalBgHeight) / 2 + shiftY;

            const imageSource = $settings.splitImageSrc;
            let newMagnets = [];

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
                    activeEffectId: $settings.currentEffect || 'original',
                    transform: { 
                        bgWidth: finalBgWidth, bgHeight: finalBgHeight, 
                        bgPosX: startX - magnetX, bgPosY: startY - magnetY 
                    }
                });
            }

            magnets.set(newMagnets);
            
            if (loaderEl) loaderEl.style.display = 'none';
        });
    }

    function handleSaveMosaic(event) {
        const newTransform = event.detail;
        if (loaderEl) loaderEl.style.display = 'block';
        editorSettings.update(s => ({ ...s, splitTransform: newTransform }));
        isSplitEditing = false;
        setTimeout(calculateAndRenderSplitGrid, 50);
    }

    function togglePanel(name) { activePanel = activePanel === name ? null : name; }

    function handleEffectsDockClick(context) {
        // #region agent log
        fetch('http://127.0.0.1:7673/ingest/3221cbc6-40ae-4c77-a825-a11fe005892b', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Debug-Session-Id': '06a31e'
            },
            body: JSON.stringify({
                sessionId: '06a31e',
                runId: 'initial',
                hypothesisId: 'H0',
                location: 'src/routes/uploader/+page.svelte:handleEffectsDockClick',
                message: 'effects dock clicked',
                data: {
                    context,
                    currentProductType: $editorSettings.currentProductType,
                    magnetsCount: $magnets.length,
                    activePanel
                },
                timestamp: Date.now()
            })
        }).catch(() => {});
        // #endregion agent log

        togglePanel('effects');
    }

    function handleSizeChange(event) {
        const newScale = parseFloat(event.target.value);
        editorSettings.update(s => ({ ...s, currentDisplayScale: newScale }));
        requestAnimationFrame(() => {
            const newSize = BASE_MAGNET_SIZE * newScale;
            magnets.update(list => list.map(m => ({ ...m, size: newSize })));
            if ($editorSettings.currentProductType === PRODUCT_TYPES.MAGNETS_PACK) handleReflow();
        });
    }

    function applyEffectToAllMagnets(effectId) {
        // #region agent log
        fetch('http://127.0.0.1:7673/ingest/3221cbc6-40ae-4c77-a825-a11fe005892b', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Debug-Session-Id': '06a31e'
            },
            body: JSON.stringify({
                sessionId: '06a31e',
                runId: 'initial',
                hypothesisId: 'H1',
                location: 'src/routes/uploader/+page.svelte:applyEffectToAllMagnets',
                message: 'applyEffectToAllMagnets invoked',
                data: {
                    effectId,
                    currentProductType: $editorSettings.currentProductType,
                    magnetsCount: $magnets.length,
                    hasWorker: !!effectsWorker,
                    hasSplitImage: !!$editorSettings.splitImageSrc
                },
                timestamp: Date.now()
            })
        }).catch(() => {});
        // #endregion agent log

        editorSettings.update(s => ({ ...s, currentEffect: effectId }));
        magnets.update(list => list.map(m => ({ ...m, activeEffectId: effectId })));
        
        if (effectId === 'original') return;

        if ($editorSettings.currentProductType === PRODUCT_TYPES.MOSAIC) {
            if (!$editorSettings.splitImageCache || !$editorSettings.splitImageCache[effectId]) {
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

    function incrementGrid() { 
        if (loaderEl) loaderEl.style.display = 'block';
        setTimeout(() => { editorSettings.update(s => ({ ...s, gridBaseSize: s.gridBaseSize + 1 })); calculateAndRenderSplitGrid(); }, 50);
    }
    
    function decrementGrid() { 
        if ($editorSettings.gridBaseSize > MIN_GRID_BASE) { 
            if (loaderEl) loaderEl.style.display = 'block';
            setTimeout(() => { editorSettings.update(s => ({ ...s, gridBaseSize: s.gridBaseSize - 1 })); calculateAndRenderSplitGrid(); }, 50);
        } 
    }

    function handleDeleteRequest(event) {
        const id = event.detail.id;
        magnets.update(list => list.filter(m => m.id !== id));
        setTimeout(handleReflow, 0);
    }

    function handleToggleVisibility(event) {
        const id = event.detail.id;
        magnets.update(list => list.map(m => {
            if (m.id === id) return { ...m, hidden: !m.hidden };
            return m;
        }));
    }

    function handleAddToCartMosaic() {
        if (canAddToCartMosaic) {
            saveWorkspaceToCart();
        }
    }
</script>

<div class="canvas-container" 
     class:container-dark={$editorSettings.isSurfaceDark} 
     class:split-center={$editorSettings.currentProductType === PRODUCT_TYPES.MOSAIC}
     class:mobile-grid-active={$isMobile && $editorSettings.currentProductType === PRODUCT_TYPES.MAGNETS_PACK}>
    
    <div 
        id="configurator-surface" 
        bind:this={surfaceEl} 
        style="min-height: {$editorSettings.surfaceMinHeight};"
        class:surface-dark={$editorSettings.isSurfaceDark}
    >
        {#each $magnets as magnet (magnet.id)}
            <div 
                class="magnet-wrapper"
                style="left: {magnet.position.x}px; top: {magnet.position.y}px; width: {magnet.size}px; height: {magnet.size}px;"
                use:draggable={{
                    enabled: $editorSettings.currentProductType === PRODUCT_TYPES.MAGNETS_PACK && !$isMobile,
                    onDragEnd: (e) => onMagnetDragEnd({ ...e, id: magnet.id })
                }}
            >
                <Magnet 
                    {...magnet}
                    position={{x:0, y:0}} 
                    isSplitPart={$editorSettings.currentProductType === PRODUCT_TYPES.MOSAIC}
                    hidden={magnet.hidden} 
                    on:delete={handleDeleteRequest}
                    on:toggleVisibility={handleToggleVisibility} 
                    on:dblclick={(e) => e.preventDefault()} 
                />
            </div>
        {/each}
    </div>
        
    {#if $magnets.length === 0 && !$editorSettings.splitImageSrc && !isGiftMode}
    <div id="initial-upload-prompt">
        <button id="initial-upload-btn" on:click={triggerUploadAction}>
            {#if $editorSettings.currentProductType === PRODUCT_TYPES.MAGNETS_PACK}
                הוסף תמונות
            {:else}
                <div class="mosaic-icon">
                    <span></span><span></span><span></span>
                    <span></span><span></span><span></span>
                    <span></span><span></span><span></span>
                </div>
            {/if}
        </button>
        {#if $editorSettings.currentProductType === PRODUCT_TYPES.MOSAIC}
            <span id="initial-upload-text">בחר תמונה לפיצול</span>
        {/if}
    </div>
    {/if}
    
    {#if isGiftMode && !$editorSettings.giftImage}
        <div class="gift-only-mode-msg">
            <h3>עריכת מתנה</h3>
            <p>לחץ על כפתור המתנה למטה כדי להחליף תמונה</p>
        </div>
    {/if}
</div>

{#if isGiftMode}
    <footer class="glass-dock" transition:fade>
        <button class="dock-btn-text" on:click={() => { resetSystem(); goto('/select'); }}>ביטול</button>
        <div class="dock-divider"></div>
        <GiftButton /> 
    </footer>
{:else}
    {#if $editorSettings.currentProductType === PRODUCT_TYPES.MAGNETS_PACK && $magnets.length > 0}
        <footer class="glass-dock" transition:fade>
            <button class="dock-btn-text mobile-hidden" on:click={() => { handleReflow(); activePanel = null; }}>סדר מחדש</button>
            <div class="dock-divider mobile-hidden"></div>
            <button class="dock-btn-text mobile-hidden" on:click={() => togglePanel('size')}>גודל</button>
            <button class="dock-btn-text" on:click={() => handleEffectsDockClick('pack-dock')}>אפקטים</button>
            <button class="dock-btn-text" on:click={() => editorSettings.update(s => ({...s, isSurfaceDark: !s.isSurfaceDark}))}>רקע</button>
            
            <div class="dock-divider"></div>
            <GiftButton />
            <UpsellWidget />
            <button class="dock-btn-circle secondary" on:click={() => { triggerUploadAction(); activePanel = null; }} title="הוסף עוד תמונות">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
        </footer>
    {/if}
    {#if $editorSettings.currentProductType === PRODUCT_TYPES.MOSAIC && $editorSettings.splitImageSrc}
    <footer class="glass-dock" transition:fade>
         <button class="dock-btn-text" on:click={() => { triggerUploadAction(); activePanel = null; }}>החלפה</button>
         
         <button class="dock-btn-text mobile-hidden" on:click={() => editorSettings.update(s => ({...s, isSurfaceDark: !s.isSurfaceDark}))}>רקע</button>
         
         <button class="dock-btn-text" on:click={() => handleEffectsDockClick('mosaic-dock')}>אפקטים</button> 
         
         <div class="dock-divider"></div>
         <GiftButton />
         <UpsellWidget />
         
         <button class="dock-btn-circle secondary" on:click={() => togglePanel('grid')} data-tooltip="גודל רשת">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="3" y1="9" x2="21" y2="9"></line>
                <line x1="3" y1="15" x2="21" y2="15"></line>
                <line x1="9" y1="3" x2="9" y2="21"></line>
                <line x1="15" y1="3" x2="15" y2="21"></line>
             </svg>
         </button>
         <button class="dock-btn-circle secondary" on:click={() => isSplitEditing = true} data-tooltip="חיתוך">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M6 2v14a2 2 0 0 0 2 2h14"></path>
                <path d="M18 22V8a2 2 0 0 0-2-2H2"></path>
             </svg>
         </button>
    </footer>
{/if}
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

<FloatingPanel title="גודל הרשת" isOpen={activePanel === 'grid'} on:close={() => activePanel = null}>
    <div class="grid-control-panel">
        <button class="round-control-btn" on:click={decrementGrid} disabled={$editorSettings.gridBaseSize <= MIN_GRID_BASE}>-</button>
        <div class="grid-info">
            <span class="grid-dim" dir="ltr">{splitGridInfo.cols} x {splitGridInfo.rows}</span>
            <span class="grid-total">({splitGridInfo.total} יחידות)</span>
        </div>
        <button class="round-control-btn" on:click={incrementGrid}>+</button>
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
        gridSettings={{ cols: splitGridInfo.cols, rows: splitGridInfo.rows }}
        on:save={handleSaveMosaic}
        on:close={() => isSplitEditing = false}
    />
{/if}

<style>
    .magnet-wrapper { position: absolute; touch-action: none; z-index: 10; }
    .magnet-wrapper.draggable-active { z-index: 1000; cursor: grabbing; }
    #configurator-surface { background-color: #F2F0EC; transition: background-color 0.3s ease; position: relative; }
    #configurator-surface.surface-dark { background-color: #1E1E1E; }
    
    .mosaic-icon { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; width: 24px; height: 24px; }
    .mosaic-icon span { background-color: currentColor; border-radius: 1px; width: 100%; height: 100%; }
    
    .canvas-container.split-center #configurator-surface { display: flex; justify-content: center; align-items: center; }
    
    .brand-loader-bar { position: fixed; bottom: 0; left: 0; width: 100%; height: 6px; background-color: #F2F0EC; z-index: 9999; overflow: hidden; }
    .loader-progress { width: 100%; height: 100%; background: linear-gradient(90deg, #3F524F, #846349, #475160, #3F524F); background-size: 200% 100%; animation: brandLoading 1.5s infinite linear; }
    @keyframes brandLoading { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
    
    .grid-control-panel { display: flex; align-items: center; justify-content: space-between; gap: 20px; width: 100%; padding: 10px; }
    .round-control-btn { width: 40px; height: 40px; border-radius: 50%; border: 2px solid var(--color-pink); background: white; color: var(--color-pink); font-size: 24px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; padding-bottom: 4px; }
    .round-control-btn:disabled { border-color: #ccc; color: #ccc; cursor: not-allowed; }
    
    .grid-info { display: flex; flex-direction: column; align-items: center; }
    .grid-dim { font-size: 20px; font-weight: 700; color: var(--color-medium-blue-gray); }
    .grid-total { font-size: 14px; color: #666; }
    
    .size-slider-container { display: flex; align-items: center; gap: 15px; }
    .size-slider-container span { font-size: 16px; color: var(--color-medium-blue-gray); }
    
    .effects-list { display: flex; gap: 15px; justify-content: center; padding: 5px 0; overflow-x: auto; }
    .effect-select-btn { background: none; border: none; cursor: pointer; padding: 0; font-family: 'Assistant', sans-serif; font-size: 14px; color: var(--color-medium-blue-gray); font-weight: 600; display: flex; flex-direction: column; align-items: center; gap: 5px; }
    .effect-select-btn .thumbnail-wrapper { width: 80px; height: 80px; border-radius: 8px; border: 3px solid transparent; overflow: hidden; }
    .effect-select-btn .thumbnail-wrapper img { width: 100%; height: 100%; object-fit: cover; }
    .effect-select-btn.active .thumbnail-wrapper { border-color: var(--color-pink); }
    
    .dock-btn-circle.disabled { background-color: #ccc; cursor: not-allowed; opacity: 0.7; }
    .dock-btn-circle.disabled:hover { transform: none; }
    
    .gift-only-mode-msg { position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: var(--color-medium-blue-gray); pointer-events: none; }
    
    /* Mobile Grid Override */
    @media (max-width: 768px) {
        .canvas-container.mobile-grid-active {
            overflow-y: auto !important; /* גלילה אנכית רק כשיש תוכן */
            overflow-x: hidden !important; /* ללא גלילה אופקית */
        }
        
        .mobile-grid-active #configurator-surface {
            display: grid !important;
            grid-template-columns: repeat(2, 1fr) !important;
            grid-auto-rows: min-content;
            gap: 16px !important;
            padding: 16px !important;
            
            height: auto !important;
            min-height: 100% !important;
            width: 100% !important;
            box-sizing: border-box !important;
            align-content: start !important;
            direction: ltr !important;
        }
        .mobile-grid-active .magnet-wrapper {
            position: relative !important;
            inset: auto !important;
            width: 100% !important;
            height: auto !important;
            aspect-ratio: 1 / 1 !important;
            margin: 0 !important;
            transform: none !important;
            z-index: 1 !important;
            border-radius: 12px !important;
            overflow: hidden !important;
            box-shadow: 0 4px 10px rgba(0,0,0,0.05) !important;
        }
        .mobile-grid-active .magnet,
        .mobile-grid-active .image-wrapper {
            width: 100% !important;
            height: 100% !important;
            position: static !important;
            border-radius: 0 !important;
            transform: none !important;
            pointer-events: auto !important;
        }
        .mobile-grid-active img {
            display: block !important;
            image-rendering: -webkit-optimize-contrast; 
            pointer-events: auto !important;
        }
        .mobile-grid-active .overlay,
        .mobile-grid-active .control-btn {
            display: none !important;
        }
        .mobile-hidden {
            display: none !important;
        }
    }
    
    /* Desktop Mosaic Final Fix */
    @media (min-width: 769px) {
        .canvas-container.split-center {
            direction: ltr !important;
            display: grid !important;
            justify-items: center; 
            align-items: start; 
            align-content: start;
            padding-top: 50px;
            padding-bottom: 120px;
            width: 100%;
            height: 100%;
            overflow: hidden !important;
            box-sizing: border-box;
        }
        
        .canvas-container.split-center #configurator-surface {
            background-color: transparent !important;
            box-shadow: none !important;
            margin: 0 !important;
            position: relative;
            max-width: none !important;
            max-height: none !important;
            overflow: visible !important;
            transition: width 0.3s ease-out, height 0.3s ease-out;
        }
    }
    
    /* Mobile Mosaic Full Width Fix */
    @media (max-width: 768px) {
        .canvas-container.split-center {
            padding: 0 !important;
            background-color: var(--color-dark-blue);
            overflow-y: auto !important; /* גלילה אנכית רק כשיש תוכן */
            overflow-x: hidden !important; /* ללא גלילה אופקית */
        }
        .canvas-container.split-center #configurator-surface {
            width: 100% !important;
            padding: 0 !important;
            display: block !important; /* block כדי לאפשר position absolute */
            position: relative !important;
            overflow-x: hidden !important;
            overflow-y: visible !important;
        }
        
        body {
            overflow-x: hidden;
        }
    }
</style>