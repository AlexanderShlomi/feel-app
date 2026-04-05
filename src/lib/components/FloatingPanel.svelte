<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { fly } from 'svelte/transition'; // הסרנו את fade לרקע כי הוא שקוף
    
    export let title = 'Panel';
    export let isOpen = false;
    
    const dispatch = createEventDispatcher();
    let openedAt = 0;
    /** במובייל הפאנל למעלה כדי שלא יכסה את התמונה; אנימציית fly תואמת כיוון */
    let panelFlyY = 20;

    onMount(() => {
        const mq = window.matchMedia('(max-width: 768px)');
        const sync = () => {
            panelFlyY = mq.matches ? -28 : 20;
        };
        sync();
        mq.addEventListener('change', sync);
        return () => mq.removeEventListener('change', sync);
    });
    
    $: if (isOpen) {
        if (openedAt === 0) openedAt = Date.now();
    } else {
        openedAt = 0;
    }
    
    function close() {
        dispatch('close');
    }
    
    /** מונע סגירה מיידית מכפתור "אפקטים" במובייל – ה-ghost click אחרי tap */
    function handleBackdropClick() {
        if (openedAt && (Date.now() - openedAt) < 400) return;
        close();
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
    <div class="panel-backdrop" on:click={handleBackdropClick} use:portal />
    
    <div 
        class="floating-panel active" 
        use:portal 
        transition:fly={{ y: panelFlyY, duration: 300, opacity: 1 }}
        on:click|stopPropagation
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
    /* --- רקע (Backdrop) - panel-backdrop כדי לא להיות מושפע מ-.backdrop הגלובלי (z-index: 5000) --- */
    .panel-backdrop {
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

    /* --- התאמות למובייל: פאנל מתחת ל-header — לא מכסה את אזור התצוגה המרכזי --- */
    @media (max-width: 768px) {
        .floating-panel {
            top: calc(70px + env(safe-area-inset-top, 0px) + 12px);
            bottom: auto;
            width: 90vw; 
            min-width: unset;
            max-height: min(45vh, 360px);
        }

        .floating-panel .panel-content {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            overscroll-behavior: contain;
        }
    }
</style>