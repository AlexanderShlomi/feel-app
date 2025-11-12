<svelte:head>
    <title>FEEL - עריכת מגנט</title>
</svelte:head>

<script>
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { magnets, editorSettings, getMagnetById, updateMagnetTransform } from '$lib/stores.js';

    // קריאת ה-ID מה-URL
    const magnetId = $page.params.magnetId;
    
    // שליפת המגנט מה-"מוח" שלנו
    let magnet;
    magnets.subscribe(list => {
        magnet = list.find(m => m.id === magnetId);
    })();
    
    // אם המגנט לא נמצא (למשל, אחרי ריענון עמוד), החזר לעורך
    if (!magnet) {
        goto('/uploader');
    }
    
    // משתני עריכה מקומיים
    let currentEditZoom = magnet.transform.zoom;
    let currentEditX = magnet.transform.x;
    let currentEditY = magnet.transform.y;
    
    // שמירת המצב המקורי לאיפוס
    const originalEditData = { ...magnet.transform };

    // משתני גרירה
    let isEditingDrag = false;
    let editStartPosX = 0;
    let editStartPosY = 0;
    
    let editImageEl; // קישור לתג התמונה

    function applyEditTransform() {
        if (!editImageEl) return;

        // הגבלת התזוזה (panning) כך שהתמונה לא "תברח" מהמסגרת
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
    }

    function saveAndClose() {
        // שמירת הנתונים המעודכנים בחזרה ל-"מוח"
        updateMagnetTransform(magnetId, {
            zoom: currentEditZoom,
            x: currentEditX,
            y: currentEditY
        });
        goto('/uploader'); // חזרה לעורך
    }
    
    function cancelAndClose() {
        goto('/uploader'); // חזרה לעורך בלי לשמור
    }

    // --- לוגיקת גרירה ---
    function getEventPosition(e) {
        return e.touches ? e.touches[0] : e;
    }

    function startEditDrag(e) {
        e.preventDefault();
        isEditingDrag = true;
        const pos = getEventPosition(e);
        editStartPosX = pos.clientX;
        editStartPosY = pos.clientY;
        
        // קריאת המיקום הנוכחי מחדש
        currentEditX = magnet.transform.x;
        currentEditY = magnet.transform.y;
        
        editImageEl.style.transition = 'none';
    }

    function editDrag(e) {
        if (!isEditingDrag) return;
        e.preventDefault();
        const pos = getEventPosition(e);
        
        const deltaX = (pos.clientX - editStartPosX);
        const deltaY = (pos.clientY - editStartPosY);
        
        // עדכון המיקום הנוכחי מחולק בזום
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
        
        // עדכון הטרנספורם במשתנה המגנט באופן זמני
        magnet.transform = { zoom: currentEditZoom, x: currentEditX, y: currentEditY };
    }

</script>

<div class="edit-canvas-container">
    <div class="edit-frame">
        <img 
            src={magnet.originalSrc} 
            id="edit-image" 
            alt="עריכת תמונה"
            bind:this={editImageEl}
            style="transform: scale({currentEditZoom}) translate({currentEditX}px, {currentEditY}px);"
            on:mousedown={startEditDrag}
            on:touchstart|preventDefault={startEditDrag}
        />
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
    <button class="toolbar-btn" id="edit-save-btn" on:click={saveAndClose}>שמור שינויים</button>
</footer>

<svelte:window 
    on:mousemove={editDrag} 
    on:mouseup={endEditDrag}
    on:touchmove|preventDefault={editDrag}
    on:touchend={endEditDrag}
/>