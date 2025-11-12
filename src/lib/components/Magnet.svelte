<script>
    import { createEventDispatcher } from 'svelte';
    import { goto } from '$app/navigation'; // ייבוא פונקציית ניווט

    // נתונים שהרכיב מקבל:
    export let id; // ID ייחודי
    export let src; // מקור התמונה
    export let transform; // אובייקט של זום ומיקום
    export let position; // מיקום (top/left) על הקנבס
    export let size; // גודל (width/height) של הרכיב
    export let isSplitPart = false; // האם זה חלק מפסיפס?
    
    let magnetElement; // משתנה שיחזיק את ה-DOM

    const dispatch = createEventDispatcher();

    // פונקציות ששולחות "אירועים" לרכיב האב (העורך)
    function handleDelete(e) {
        e.stopPropagation();
        dispatch('delete', { id });
    }

    function handleEdit(e) {
        e.stopPropagation();
        // מנווט ישירות לעמוד העריכה
        goto(`/uploader/edit/${id}`);
    }

    function handleDragStart(e) {
        e.stopPropagation();
        // שולח את האירוע, ה-ID, ואת אלמנט ה-DOM עצמו
        dispatch('dragstart', { id, event: e, element: magnetElement });
    }
</script>

<div
    bind:this={magnetElement}
    data-id={id}
    class="magnet-preview"
    class:draggable={!isSplitPart}
    class:split-part={isSplitPart}
    style="
        left: {position.x}px; 
        top: {position.y}px; 
        width: {size}px; 
        height: {size}px;
    "
    on:mousedown={handleDragStart}
    on:touchstart|preventDefault={handleDragStart}
>
    {#if isSplitPart}
        <div 
            class="split-image"
            style="
                background-image: url({src});
                background-size: {transform.bgWidth}% {transform.bgHeight}%;
                background-position: {transform.bgPosX}% {transform.bgPosY}%;
            "
        ></div>
    {:else}
        <img 
            src={src} 
            alt="magnet preview" 
            style="transform: scale({transform.zoom}) translate({transform.x}px, {transform.y}px);" 
        />
    {/if}
    
    {#if !isSplitPart} <span class="edit-btn" on:click={handleEdit} on:mousedown|stopPropagation>&#9998;</span>
    {/if}
    <span class="delete-btn" on:click={handleDelete} on:mousedown|stopPropagation>&times;</span>
</div>

<style>
    .split-image {
        width: 100%;
        height: 100%;
    }
</style>