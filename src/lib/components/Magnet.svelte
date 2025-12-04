<script>
    import { createEventDispatcher } from 'svelte';
    import { getFilterStyle } from '$lib/stores.js'; 
    
    export let id;
    export let src; 
    export let position = { x: 0, y: 0 };
    export let size = 150;
    export let transform = null;
    export let isSplitPart = false;
    export let hidden = false; 
    
    // נשאר כדי למנוע שגיאות אם האבא שולח את זה, גם אם לא בשימוש ישיר כאן
    export let activeEffectId = 'original';
    export let processed = {}; 

    const dispatch = createEventDispatcher();
    
    // חישוב CSS משופר וקריא
    $: filterCss = getFilterStyle(activeEffectId);
    
    // הכנת משתני CSS דינמיים
    $: cssVars = `
        --magnet-size: ${size}px;
        --pos-x: ${position.x}px;
        --pos-y: ${position.y}px;
        --zoom: ${(!isSplitPart && transform) ? transform.zoom : 1};
        --trans-x: ${(!isSplitPart && transform) ? transform.x * 100 : 0}%;
        --trans-y: ${(!isSplitPart && transform) ? transform.y * 100 : 0}%;
        --bg-w: ${(isSplitPart && transform) ? transform.bgWidth : 0}px;
        --bg-h: ${(isSplitPart && transform) ? transform.bgHeight : 0}px;
        --bg-x: ${(isSplitPart && transform) ? transform.bgPosX : 0}px;
        --bg-y: ${(isSplitPart && transform) ? transform.bgPosY : 0}px;
    `;

    // טיפול באירועים
    function handleInteraction(e) {
        if (isSplitPart) {
            dispatch('toggleVisibility', { id });
        } else {
            // שולח את האירוע לאבא (uploader) לטיפול בגרירה
            dispatch('dragstart', { id, event: e, element: e.target.closest('.magnet-container') });
        }
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
    style="{cssVars}"
    on:mousedown={handleInteraction} 
    on:touchstart={handleInteraction}
>
    <div class="image-wrapper" class:sharp-corners={isSplitPart}>
        {#if isSplitPart && transform}
            <div 
                class="split-image" 
                style="{filterCss}; background-image: url('{src}');"
            ></div>
        {:else}
            <img 
                src={src} 
                alt="" 
                draggable="false" 
                style="{filterCss}; transform: scale(var(--zoom)) translate(var(--trans-x), var(--trans-y));" 
                on:error={handleImageError} 
            />
        {/if}

        <div class="overlay" class:force-visible={hidden && isSplitPart}>
            {#if !isSplitPart}
                <a href="/uploader/edit/{id}" class="control-btn edit-btn" on:mousedown|stopPropagation>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                </a>
                <button class="control-btn delete-btn" on:click|stopPropagation={() => dispatch('delete', { id })} on:mousedown|stopPropagation>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            {:else}
                {#if !hidden}
                    <button class="control-btn delete-btn" on:click|stopPropagation={() => dispatch('toggleVisibility', { id })} on:mousedown|stopPropagation>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                {:else}
                    <div class="restore-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </div>
                {/if}
            {/if}
        </div>
    </div>
</div>

<style>
    .magnet { 
        position: absolute;
        /* שימוש במשתנים למיקום - יעיל יותר */
        width: var(--magnet-size);
        height: var(--magnet-size);
        left: var(--pos-x);
        top: var(--pos-y);
        
        touch-action: none; 
        user-select: none; 
        cursor: grab; 
        padding: 4px; 
        box-sizing: border-box; 
        transition: opacity 0.2s, top 0.2s ease-out, left 0.2s ease-out; 
        will-change: top, left; 
    }
    
    .magnet.is-hidden .image-wrapper {
        opacity: 0.3; 
        filter: grayscale(100%);
        border: 1px dashed #ccc;
    }
    .magnet.split-part { padding: 0; cursor: pointer; }
    
    .magnet.draggable { 
        z-index: 1000; 
        cursor: grabbing; 
        transition: none !important; 
        transform: scale(1.05); 
        filter: drop-shadow(0 15px 30px rgba(0,0,0,0.25));
    }
    
    .image-wrapper { 
        width: 100%; 
        height: 100%; 
        position: relative; 
        border-radius: 12px; 
        overflow: hidden; 
        background: #fff;
        box-shadow: 0 4px 10px rgba(0,0,0,0.08); 
        transition: transform 0.3s, box-shadow 0.3s, opacity 0.2s; 
        z-index: 1;
        -webkit-backface-visibility: hidden;
        backface-visibility: hidden;
        box-sizing: border-box;
    }
    
    .magnet.split-part .image-wrapper { background: transparent; }
    .image-wrapper.sharp-corners { border-radius: 0 !important; box-shadow: none; }
    
    .magnet:hover .image-wrapper { box-shadow: 0 12px 24px rgba(0,0,0,0.15); }
    .magnet.split-part:hover .image-wrapper { box-shadow: none; transform: none; }
    .magnet.split-part:active .image-wrapper { transform: scale(0.98); }

    .split-image { 
        position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
        image-rendering: -webkit-optimize-contrast; 
        
        /* background-image הוסר מכאן ועבר ל-HTML style 
           כדי לפתור את השגיאות ב-VS Code
        */
        
        background-size: var(--bg-w) var(--bg-h);
        background-position: var(--bg-x) var(--bg-y);
        background-repeat: no-repeat;
    }
    
    img { 
        width: 100%; height: 100%; object-fit: cover; display: block; 
        transition: transform 0.5s ease;
        transform-origin: center center; 
        text-indent: -10000px; 
    }
    
    .overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(2px); opacity: 0; transition: opacity 0.3s; z-index: 10; }
    .magnet:hover .overlay { opacity: 1; }
    .overlay.force-visible { opacity: 1; background: rgba(255,255,255,0.2); }
    
    .control-btn { position: absolute; top: 5%; width: 20%; height: 20%; max-width: 32px; max-height: 32px; min-width: 16px; min-height: 16px; border-radius: 50%; background: rgba(255,255,255,0.95); border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); opacity: 0; transform: scale(0.8) translateY(5px); transition: all 0.3s; padding: 0; }
    .overlay:hover .control-btn { opacity: 1; transform: scale(1) translateY(0); }
    .control-btn:hover { background: white; transform: scale(1.1) !important; box-shadow: 0 6px 16px rgba(0,0,0,0.2); }
    .control-btn:active { transform: scale(0.95) !important; }
    .control-btn svg { width: 50%; height: 50%; }
    
    .edit-btn { left: 5%; color: #333; }
    .delete-btn { right: 5%; color: #e53935; transition-delay: 0.05s; }
    .delete-btn:hover { background: #ffebee; }
    .restore-icon { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #333; width: 32px; height: 32px; opacity: 0.7; }
</style>