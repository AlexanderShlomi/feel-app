<script>
    import { createEventDispatcher } from 'svelte';
    import CartCounter from '$lib/components/CartCounter.svelte';

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
        <CartCounter />
    </div>
</header>

<style>
    /* מיקום Header ראשי - סגנונות בסיסיים מוגדרים ב-app.css */
    .app-header {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        width: 100%;
        z-index: 100;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    }
</style>