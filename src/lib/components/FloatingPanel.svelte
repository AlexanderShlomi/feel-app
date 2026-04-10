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
    <div class="panel-backdrop" role="presentation" on:click={handleBackdropClick} use:portal></div>
    
    <div
        class="floating-panel active"
        use:portal
        transition:fly={{ y: panelFlyY, duration: 300, opacity: 1 }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabindex="-1"
        on:click|stopPropagation
        on:keydown={(e) => e.key === 'Escape' && close()}
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
        inset: 0;
        min-height: 100vh;
        min-height: 100dvh;
        /* 🔥 שקוף לחלוטין כדי לראות את התמונה בבירור */
        background: transparent;
        z-index: 4500;
    }

    /* --- עיצוב הפאנל --- */
    .floating-panel {
        position: fixed;
        z-index: 4501;
        box-sizing: border-box;
        
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

    .panel-content {
        box-sizing: border-box;
        max-width: 100%;
        overflow-x: hidden;
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

    /* --- מובייל: מעל ה-dock (לא מתחת ל-header) — fixed + transform בדוק שובר מיקום אם הפאנל בתוךו --- */
    @media (max-width: 768px) {
        .floating-panel {
            top: auto;
            bottom: calc(100px + env(safe-area-inset-bottom, 0px) + var(--vv-bottom-chrome, 0px));
            left: 50%;
            right: auto;
            transform: translateX(-50%);
            width: min(92vw, 400px);
            min-width: unset;
            max-width: 92vw;
            max-height: min(62vh, 460px);
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