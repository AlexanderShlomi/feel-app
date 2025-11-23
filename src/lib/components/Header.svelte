<script>
    import { page } from '$app/stores';
    import { createEventDispatcher } from 'svelte';

    const dispatch = createEventDispatcher();
    function toggleMenu() {
        dispatch('toggleMenu');
    }
</script>

<header class="app-header">
    <div class="header-right">
        <button class="hamburger-btn header-icon-btn" on:click={toggleMenu}>
            &#9776;
        </button>
    </div>
    
    <div class="header-center">
        <a href="/" class="logo">
            <img src="/Logo.svg" alt="FEEL Logo" class="logo-img">
        </a>
    </div>

    <div class="header-left">
        {#if $page.route.id !== '/' && $page.route.id !== '/select'}
            <a href="/select" class="header-icon-btn">
                &lt;
            </a>
        {:else}
            <button class="header-icon-btn visibility-hidden">&lt;</button>
        {/if}
    </div>
</header>