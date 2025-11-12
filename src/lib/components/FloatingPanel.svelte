<script>
    import { createEventDispatcher } from 'svelte';

    export let title = 'Floating Panel'; // כותרת דינמית
    export let isOpen = false;

    const dispatch = createEventDispatcher();

    function close() {
        dispatch('close');
    }
</script>

{#if isOpen}
    <div class="floating-panel active">
        <div class="floating-panel-header">
            <h4>{title}</h4>
            <button class="done-btn" on:click={close}>סיום</button>
        </div>
        
        <slot />
    </div>
{/if}