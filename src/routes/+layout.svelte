<script>
    import '../app.css'; 
    import Header from '$lib/components/Header.svelte';
    import SideMenu from '$lib/components/SideMenu.svelte';
    import { onMount } from 'svelte';
    import { initApp, isGlobalLoading } from '$lib/stores.js'; // הוספת הייבוא של isGlobalLoading
 
    let isMenuOpen = false;
    function toggleMenu() {
        isMenuOpen = !isMenuOpen;
    }

    onMount(() => {
        initApp();
    });
</script>

<div class="page-container" dir="rtl">
    
    {#if $isGlobalLoading}
        <div class="global-loader-overlay">
            <div class="brand-loader-bar">
                <div class="loader-progress"></div>
            </div>
        </div>
    {/if}

    <Header on:toggleMenu={toggleMenu} />
    <SideMenu bind:isOpen={isMenuOpen} />
    
    <slot />

</div>

<style>
    /* 🔥 עיצוב הלאודר הגלובלי */
    .global-loader-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(255, 255, 255, 0.5); /* רקע חצי שקוף */
        z-index: 10000; /* מעל הכל, כולל סל הקניות */
        pointer-events: none; /* כדי לא לחסום לחיצות אם זה נתקע, או auto כדי לחסום */
        cursor: wait;
    }

    .brand-loader-bar {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 6px;
        background-color: transparent;
        overflow: hidden;
    }

    .loader-progress {
        width: 100%;
        height: 100%;
        /* אותו גרדיאנט יפה שביקשת */
        background: linear-gradient(90deg, #3F524F, #846349, #475160, #3F524F);
        background-size: 200% 100%;
        animation: brandLoading 1.5s infinite linear;
    }

    @keyframes brandLoading {
        0% { background-position: 100% 0; }
        100% { background-position: -100% 0; }
    }
</style>