<script>
    import { createEventDispatcher } from 'svelte';
    import { goto } from '$app/navigation';
    import { editorSettings } from '$lib/stores.js';

    // נתונים שהרכיב מקבל:
    export let id;
    export let position; 
    export let size;
    export let isSplitPart = false;

    // ✅ ארכיטקטורה חדשה: 
    // הרכיב מקבל את כל נתוני המקור והמטמון
    export let originalSrc;
    export let processed; // אובייקט המטמון: { original, silver, ... }
    export let transform;
    export let src; // עדיין רלוונטי עבור פסיפס
    
    let magnetElement; 
    const dispatch = createEventDispatcher();

    // ✅ ארכיטקטורה חדשה: 
    // משתנה שמחשב איזו גרסת תמונה להציג
    $: currentEffectId = $editorSettings.currentEffect;
    $: currentSrc = (processed && processed[currentEffectId]) 
                    ? processed[currentEffectId] // 'data:image...' (מעובד) או 'processing'
                    : originalSrc; // או המקור אם אין כלום

    // --- פונקציות אירועים ---
    function handleDelete(e) {
        e.stopPropagation();
        dispatch('delete', { id });
    }

    function handleEdit(e) {
        e.stopPropagation();
        // שלח את ה-originalSrc לעמוד העריכה
        goto(`/uploader/edit/${id}`);
    }

    function handleDragStart(e) {
        e.stopPropagation();
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
            class:effect-silver={$editorSettings.currentEffect === 'silver'}
            class:effect-noir={$editorSettings.currentEffect === 'noir'}
            class:effect-vivid={$editorSettings.currentEffect === 'vivid'}
            class:effect-dramatic={$editorSettings.currentEffect === 'dramatic'}
            style="
                background-image: url({src});
                background-size: {transform.bgWidth}% {transform.bgHeight}%;
                background-position: {transform.bgPosX}% {transform.bgPosY}%;
            "
        ></div>
    {:else}
        {#if currentSrc === 'processing'}
            <div class="magnet-loader">
                <div class="loader-spinner"></div>
            </div>
        {:else if currentSrc}
            <img 
                src={currentSrc} 
                alt="magnet preview" 
                style="transform: scale({transform.zoom}) translate({transform.x}px, {transform.y}px);" 
            />
        {/if}
    {/if}
    
    {#if !isSplitPart}
        <span class="edit-btn" on:click={handleEdit} on:mousedown|stopPropagation>&#9998;</span>
        <span class="delete-btn" on:click={handleDelete} on:mousedown|stopPropagation>&times;</span>
    {/if}
</div>

<style>
    .split-image {
        width: 100%;
        height: 100%;
        transition: filter 0.3s;
    }

    /* פילטרי SVG עדיין רלוונטיים רק עבור הפסיפס */
    :global(.split-part.effect-silver) .split-image { filter: url(#filter-silver); }
    :global(.split-part.effect-noir) .split-image { filter: url(#filter-noir); }
    :global(.split-part.effect-vivid) .split-image { filter: url(#filter-vivid); }
    :global(.split-part.effect-dramatic) .split-image { filter: url(#filter-dramatic); }

    /* ✅ עיצוב חדש לספינר טעינה (ספציפי למגנט) */
    .magnet-loader {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        background: rgba(255,255,255,0.5);
        box-sizing: border-box;
        border: 1px dashed var(--color-dark-gray);
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
    
    /* אותה אנימציה מה-loader הראשי */
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
</style>