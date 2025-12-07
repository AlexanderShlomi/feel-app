<script>
    import { createEventDispatcher } from 'svelte';
    import { fly } from 'svelte/transition'; // הסרנו את fade לרקע כי הוא שקוף
    
    export let title = 'Panel';
    export let isOpen = false;
    
    const dispatch = createEventDispatcher();
    
    function close() {
        dispatch('close');
    }

    // פונקציית ה-Portal להוצאת הפאנל לגוף המסמך
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

{#if isOpen}
    <div class="backdrop" on:click={close} use:portal />
    
    <div 
        class="floating-panel active" 
        use:portal 
        transition:fly={{ y: 20, duration: 300, opacity: 1 }}
    >
        <div class="floating-panel-header">
            <h4>{title}</h4>
            <button class="done-btn" on:click={close}>סיום</button>
        </div>
        
        <div class="panel-content">
            <slot />
        </div>
    </div>
{/if}

<style>
    /* --- רקע (Backdrop) --- */
    .backdrop {
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        
        /* 🔥 שינוי קריטי: שקוף לחלוטין כדי לראות את התמונה בבירור */
        background: transparent; 
        z-index: 2000;
        
        /* ביטלנו את האנימציה ואת הטשטוש (Blur) */
    }

    /* --- עיצוב הפאנל --- */
    .floating-panel {
        position: fixed;
        z-index: 2001;
        
        /* עיצוב Glassmorphism */
        background: rgba(255, 255, 255, 0.95); /* קצת יותר אטום כדי שהטקסט בפאנל יהיה קריא */
        backdrop-filter: blur(15px) saturate(180%);
        -webkit-backdrop-filter: blur(15px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.5);
        
        box-shadow: 0 15px 50px rgba(0,0,0,0.15);
        border-radius: 24px;
        padding: 20px;
        
        /* מיקום */
        left: 50%;
        transform: translateX(-50%);
        bottom: 100px; /* מעל ה-Dock */
        
        width: auto;
        min-width: 320px;
        max-width: 90vw;
        
        display: flex;
        flex-direction: column;
        direction: rtl;
    }

    .floating-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.05);
    }
    
    .floating-panel-header h4 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        color: var(--color-medium-blue-gray);
    }
    
    .floating-panel-header .done-btn {
        background: none;
        border: none;
        color: var(--color-pink);
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        padding: 5px 10px;
        border-radius: 15px;
        transition: background 0.2s;
    }
    .floating-panel-header .done-btn:hover {
        background: rgba(63, 82, 79, 0.1);
    }

    /* --- התאמות למובייל --- */
    @media (max-width: 768px) {
        .floating-panel {
            bottom: 90px; 
            width: 90vw; 
            min-width: unset;
        }
    }
</style>