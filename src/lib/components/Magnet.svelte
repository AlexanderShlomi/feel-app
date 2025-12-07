<script>
    import { createEventDispatcher } from 'svelte';
    import { goto } from '$app/navigation'; 
    import { getFilterStyle, isMobile } from '$lib/stores.js'; 
    
    export let id;
    export let src; 
    export let size = 150; 
    export let transform = null;
    export let isSplitPart = false;
    export let hidden = false; 
    export let activeEffectId = 'original';
    
    const dispatch = createEventDispatcher();
    
    // שליפת הפילטר (SVG)
    $: filterCss = getFilterStyle(activeEffectId);
    
    $: cssVars = `
        --magnet-size: ${size}px;
        --zoom: ${(!isSplitPart && transform) ? transform.zoom : 1};
        --trans-x: ${(!isSplitPart && transform) ? transform.x * 100 : 0}%;
        --trans-y: ${(!isSplitPart && transform) ? transform.y * 100 : 0}%;
        --bg-w: ${(isSplitPart && transform) ? transform.bgWidth : 0}px;
        --bg-h: ${(isSplitPart && transform) ? transform.bgHeight : 0}px;
        --bg-x: ${(isSplitPart && transform) ? transform.bgPosX : 0}px;
        --bg-y: ${(isSplitPart && transform) ? transform.bgPosY : 0}px;
        --bg-url: url('${src}');
    `;

    // ... (שאר הפונקציות ללא שינוי: handleInteraction, handleEditClick, etc.) ...
    function handleInteraction(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        if (e && e.preventDefault) e.preventDefault();
        if (isSplitPart) { dispatch('toggleVisibility', { id }); return; } 
        if ($isMobile) { goto(`/uploader/edit/${id}`); return; }
    }
    function handleEditClick(e) {
        if (e) { e.stopPropagation(); e.preventDefault(); }
        goto(`/uploader/edit/${id}`);
    }
    function handleDeleteClick(e) {
        if (e) { e.stopPropagation(); e.preventDefault(); }
        if (isSplitPart) { dispatch('toggleVisibility', { id }); } else { dispatch('delete', { id }); }
    }
    function handleImageError(e) { 
        if (e.target.src !== src) e.target.src = src; 
        else e.target.style.opacity = 0;
    }
</script>

<div 
    class="magnet magnet-container" 
    class:split-part={isSplitPart} 
    class:is-hidden={hidden}
    class:desktop-mode={!$isMobile}
    style="{cssVars}"
    on:click={handleInteraction} 
    on:touchstart={handleInteraction}
>
    <div class="image-wrapper" class:sharp-corners={isSplitPart}>
        {#if isSplitPart && transform}
            <div class="split-image" style="{filterCss}"></div>
        {:else}
            <img 
                src={src} 
                alt="" 
                draggable="false" 
                style="{filterCss} transform: scale(var(--zoom)) translate(var(--trans-x), var(--trans-y));" 
                on:error={handleImageError} 
            />
        {/if}

        <div class="overlay" class:always-visible={$isMobile} class:force-visible={hidden} on:click={handleInteraction}>
            {#if !$isMobile && !isSplitPart && !hidden}
                <button class="control-btn edit-btn" on:click={handleEditClick} on:mousedown|stopPropagation>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                </button>
            {/if}
            {#if !hidden}
                {#if isSplitPart || (!$isMobile && !isSplitPart)}
                    <button class="control-btn delete-btn" on:click={handleDeleteClick} on:mousedown|stopPropagation on:touchstart|stopPropagation>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                {/if}
            {/if}
            {#if isSplitPart && hidden}
                <div class="restore-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    /* ... (CSS נשאר ללא שינוי מהקוד המקורי שלך) ... */
    .magnet { width: 100%; height: 100%; position: relative; touch-action: none; user-select: none; cursor: pointer; padding: 0; box-sizing: border-box; }
    .magnet.is-hidden .image-wrapper { opacity: 0.3; filter: grayscale(100%); border: 1px dashed #ccc; }
    .image-wrapper { width: 100%; height: 100%; position: relative; border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.08); transition: transform 0.3s, box-shadow 0.3s, opacity 0.2s; z-index: 1; pointer-events: none; }
    .magnet.split-part .image-wrapper { background: transparent; }
    .image-wrapper.sharp-corners { border-radius: 0 !important; box-shadow: none; }
    @media (hover: hover) {
        .magnet.desktop-mode:hover .image-wrapper { box-shadow: 0 12px 24px rgba(0,0,0,0.15); }
        .magnet.desktop-mode:hover .overlay { opacity: 1; }
    }
    .split-image { position: absolute; top: 0; left: 0; width: 100%; height: 100%; image-rendering: -webkit-optimize-contrast; background-image: var(--bg-url); background-size: var(--bg-w) var(--bg-h); background-position: var(--bg-x) var(--bg-y); background-repeat: no-repeat; }
    img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.5s ease; }
    .overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(2px); opacity: 0; transition: opacity 0.2s; z-index: 20; pointer-events: none; }
    .overlay.force-visible { opacity: 1; background: rgba(255,255,255,0.2); pointer-events: auto; }
    .magnet:hover .overlay { pointer-events: auto; }
    .control-btn { position: absolute; top: 8px; width: 32px; height: 32px; border-radius: 50%; background: white; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.2); opacity: 0; transform: scale(0.8); transition: all 0.2s; padding: 0; pointer-events: auto; z-index: 30; }
    .magnet:hover .control-btn { opacity: 1; transform: scale(1); }
    .control-btn:hover { transform: scale(1.1); background: #f5f5f7; }
    .control-btn svg { width: 18px; height: 18px; display: block; color: inherit; }
    .edit-btn { left: 8px; color: #333; }
    .delete-btn { right: 8px; color: #e53935; }
    .restore-icon { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #333; width: 32px; height: 32px; opacity: 0.7; pointer-events: none; }
</style>