<script>
    import { createEventDispatcher } from 'svelte';
    import { goto } from '$app/navigation';
    import { editorSettings } from '$lib/stores.js';

    // נתונים שהרכיב מקבל:
    export let id;
    export let position;
    export let size;
    export let isSplitPart = false;

    export let originalSrc;
    export let processed; 
    export let transform;
    export let src; 
    
    export let activeEffectId = 'original'; 

    let magnetElement; 
    const dispatch = createEventDispatcher();
    
    // חישוב למגנט בודד (משתמש עכשיו ב-prop)
    $: individualSrc = (processed && processed[activeEffectId]) 
                    ? processed[activeEffectId]
                    : originalSrc; 

    // חישוב למצב פסיפס (עדיין גלובלי)
    $: currentGlobalEffectId = $editorSettings.currentEffect;
    $: splitCache = $editorSettings.splitImageCache;
    $: splitSrc = (splitCache && splitCache[currentGlobalEffectId])
                    ? splitCache[currentGlobalEffectId]
                    : src; 
    
    // --- 🔥 התיקון: ממיר את היחס לפיקסלים ---
    $: displayX = (transform.x || 0) * size;
    $: displayY = (transform.y || 0) * size;

    // --- פונקציות אירועים ---
    function handleDelete(e) {
        e.stopPropagation();
        dispatch('delete', { id });
    }

    function handleEdit(e) {
        e.stopPropagation();
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
        
        {#if splitSrc === 'processing'}
            <div class="magnet-loader">
                <div class="loader-spinner"></div>
            </div>
        {:else}
            <div 
                class="split-image"
                style="
                    background-image: url({splitSrc || src});
                    background-size: {transform.bgWidth}% {transform.bgHeight}%;
                    background-position: {transform.bgPosX}% {transform.bgPosY}%;
                "
            ></div>
        {/if}

    {:else}
        {#if individualSrc === 'processing'}
            <div class="magnet-loader">
                <div class="loader-spinner"></div>
            </div>
        {:else if individualSrc}
            <img 
                src={individualSrc} 
                alt="magnet preview" 
                style="transform: scale({transform.zoom}) translate({displayX}px, {displayY}px);"
            />
        {/if}
    {/if}
    
    {#if !isSplitPart}
        <span class="edit-btn" on:click={handleEdit} on:mousedown|stopPropagation>&#9998;</span>
    {/if}
    
    <span class="delete-btn" on:click={handleDelete} on:mousedown|stopPropagation>&times;</span>
</div>

<style>
    .split-image {
        width: 100%;
        height: 100%;
    }

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
    
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
</style>