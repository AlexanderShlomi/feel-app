<script>
    import { fade, fly } from 'svelte/transition';
    import { editorSettings } from '$lib/stores.js';
    import FileUploader from '$lib/components/FileUploader.svelte';

    let isOpen = false;
    let isAnimating = true;

    // הפסקת הריצוד אם כבר נבחרה תמונה
    $: if ($editorSettings.giftImage) {
        isAnimating = false;
    }

    function toggleGift() {
        isOpen = !isOpen;
    }

    function handleGiftUpload(event) {
        const files = event.detail;
        if (files && files.length > 0) {
            const url = URL.createObjectURL(files[0]);
            editorSettings.update(s => ({ ...s, giftImage: url }));
            isAnimating = false; 
        }
    }

    function triggerUpload() {
        const el = document.getElementById('gift-upload-input');
        if (el) el.click();
    }

    function handleSave() {
        toggleGift();
    }

    // 🔥 פונקציית הקסם: מוציאה את החלון מחוץ ל-Dock כדי שיתמרכז למסך
    function portal(node) {
        let target = document.body;
        async function update() {
            target.appendChild(node);
            node.hidden = false;
        }
        update();
        return {
            destroy() {
                if (node.parentNode) {
                    node.parentNode.removeChild(node);
                }
            }
        };
    }
</script>

<button 
    class="dock-btn-circle gift-btn" 
    class:pulsing={isAnimating && !$editorSettings.giftImage}
    class:has-gift={$editorSettings.giftImage}
    on:click={toggleGift}
    title="מתנה מאיתנו"
>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 12 20 22 4 22 4 12"></polyline>
        <rect x="2" y="7" width="20" height="5"></rect>
        <line x1="12" y1="22" x2="12" y2="7"></line>
        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
        <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
    </svg>

    {#if $editorSettings.giftImage}
        <div class="check-badge-mini">✓</div>
    {/if}
</button>

{#if isOpen}
    <div class="gift-editor-overlay" use:portal transition:fade={{ duration: 200 }}>
        
        <div class="gift-editor-container" transition:fly={{ y: 20, duration: 300 }}>
            
            <div class="gift-editor-header">
                <h3>מתנה מאיתנו 🎁</h3>
                <button class="close-editor-btn" on:click={toggleGift}>✕</button>
            </div>

            <div class="gift-editor-body">
                <p class="gift-text">
                    עיבוד תמונה בטכנולוגיה סופר-מתקדמת, <span class="highlight">על חשבון הבית!</span>
                    <br>
                    תבחר תמונה שאתה אוהב, ואנחנו נדאג לקסם.
                </p>

                <div class="image-preview-area square-ratio" on:click={triggerUpload}>
                    {#if $editorSettings.giftImage}
                        <img src={$editorSettings.giftImage} alt="Gift" class="uploaded-gift-img" />
                        <div class="overlay-hint">לחץ להחלפה</div>
                    {:else}
                        <div class="placeholder-content">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                            <span>לחץ לבחירת תמונה</span>
                        </div>
                    {/if}
                </div>
            </div>

            <div class="gift-editor-controls">
                <button class="editor-btn secondary" on:click={toggleGift}>ביטול</button>
                
                {#if $editorSettings.giftImage}
                    <button class="save-circle-btn" on:click={handleSave}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                {/if}
            </div>

        </div>
    </div>
{/if}

<FileUploader 
    uploadId="gift-upload-input" 
    mode="multi" 
    on:filesSelected={handleGiftUpload} 
/>

<style>
    /* --- כפתור ה-Dock --- */
    .gift-btn { position: relative; color: var(--color-gold); border: 1px solid rgba(198, 178, 154, 0.3); }
    .gift-btn:hover { background-color: rgba(198, 178, 154, 0.1); transform: scale(1.1); }
    .gift-btn.has-gift { background-color: var(--color-pink); color: white; border-color: transparent; }
    .gift-btn.pulsing { animation: dock-pulse 2s infinite; }
    @keyframes dock-pulse {
        0% { box-shadow: 0 0 0 0 rgba(198, 178, 154, 0.4); }
        70% { box-shadow: 0 0 0 6px rgba(198, 178, 154, 0); }
        100% { box-shadow: 0 0 0 0 rgba(198, 178, 154, 0); }
    }
    .check-badge-mini { position: absolute; top: -2px; right: -2px; background: #4CAF50; color: white; font-size: 9px; width: 14px; height: 14px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid white; font-weight: bold; }

    /* --- Overlay --- */
    .gift-editor-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.85);
        z-index: 99999; /* Z-Index גבוה מאוד כדי לוודא שהוא מעל הכל */
        display: flex; justify-content: center; align-items: center;
        backdrop-filter: blur(5px);
    }

    .gift-editor-container {
        background: var(--color-canvas-bg);
        width: 90%; max-width: 380px; 
        border-radius: 16px; overflow: hidden;
        display: flex; flex-direction: column;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        direction: rtl; /* לוודא כיווניות */
    }

    /* Header */
    .gift-editor-header {
        padding: 18px 20px; display: flex; justify-content: space-between; align-items: center;
        background: white; border-bottom: 1px solid #eee;
    }
    .gift-editor-header h3 { margin: 0; font-size: 18px; color: var(--color-medium-blue-gray); font-weight: 800; }
    .close-editor-btn { background: none; border: none; font-size: 20px; cursor: pointer; color: #999; padding: 5px; }
    .close-editor-btn:hover { color: #333; }

    /* Body */
    .gift-editor-body {
        padding: 30px 20px;
        background: white;
        display: flex; flex-direction: column; align-items: center; gap: 20px;
        text-align: center;
    }

    .gift-text { font-size: 16px; color: var(--color-dark-gray); line-height: 1.5; margin: 0; max-width: 95%; }
    .highlight { color: var(--color-pink); font-weight: 800; }

    /* Image Area */
    .image-preview-area {
        width: 100%;
        max-width: 260px; 
        aspect-ratio: 1 / 1;
        background: var(--color-canvas-bg);
        border: 2px dashed #ccc;
        border-radius: 12px;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        overflow: hidden; position: relative;
        transition: all 0.2s;
    }
    .image-preview-area:hover { border-color: var(--color-pink); transform: scale(1.02); }
    .uploaded-gift-img { width: 100%; height: 100%; object-fit: cover; }
    .placeholder-content { display: flex; flex-direction: column; align-items: center; gap: 10px; color: #888; }
    .placeholder-content svg { width: 40px; height: 40px; opacity: 0.5; }
    .overlay-hint { position: absolute; bottom: 0; left: 0; width: 100%; background: rgba(0,0,0,0.6); color: white; font-size: 12px; padding: 6px; font-weight: 600; }

    /* Footer Controls */
    .gift-editor-controls {
        padding: 15px 25px; 
        display: flex; 
        justify-content: space-between; 
        align-items: center;
        background: #f9f9f9; 
        border-top: 1px solid #eee;
    }

    .editor-btn { background: none; border: none; cursor: pointer; font-family: 'Assistant', sans-serif; font-size: 16px; font-weight: 600; color: var(--color-medium-blue-gray); }
    .editor-btn:hover { color: var(--color-pink); }

    .save-circle-btn {
        background-color: var(--color-pink);
        color: #ffffff;
        width: 48px; height: 48px;
        border-radius: 50%; border: none;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(63, 82, 79, 0.25);
        transition: transform 0.2s;
    }
    .save-circle-btn:hover { transform: scale(1.1); background-color: #2c3a38; }
    .save-circle-btn svg { width: 24px; height: 24px; }
</style>