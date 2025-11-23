<script>
    import { createEventDispatcher } from 'svelte';

    export let title = 'Floating Panel';
    export let isOpen = false;

    const dispatch = createEventDispatcher();
    function close() {
        dispatch('close');
    }
</script>

{#if isOpen}
    <div class="backdrop" on:click={close} />

    <div class="floating-panel active">
        <div class="floating-panel-header">
            <h4>{title}</h4>
            <button class="done-btn" on:click={close}>סיום</button>
        </div>
        
        <slot />
    </div>
{/if}

<style>
    .backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.1); /* רקע אפרפר חצי-שקוף */
        z-index: 900; /* מאחורי הפאנל, מעל כל השאר */
        animation: fadeIn 0.3s;
    }

    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    /* (העיצוב הקיים של הפאנל) */
    .floating-panel {
        position: fixed;
        bottom: 100px; 
        left: 50%;
        transform: translateX(-50%) scale(0.9); 
        background: var(--color-light-gray); /* White */
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.15); 
        padding: 20px;
        z-index: 1000; /* חייב להיות מעל הרקע */
        visibility: hidden; 
        opacity: 0;
        transition: all 0.3s ease-out; 
        width: auto;
        min-width: 300px;
    }
    .floating-panel.active {
        visibility: visible;
        opacity: 1;
        transform: translateX(-50%) scale(1); 
    }
    .floating-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
    }
    .floating-panel-header h4 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        color: var(--color-medium-blue-gray); /* Ink */
    }
    .floating-panel-header .done-btn {
        background: none;
        border: none;
        color: var(--color-pink); /* Teal */
        font-size: 16px;
        font-weight: 700;
        cursor: pointer;
    }
</style>