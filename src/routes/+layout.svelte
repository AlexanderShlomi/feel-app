<script>
    import '../app.css'; 
    import Header from '$lib/components/Header.svelte';
    import SideMenu from '$lib/components/SideMenu.svelte';
    import AuthModal from '$lib/components/AuthModal.svelte';
    import PrivacyPolicy from '$lib/components/PrivacyPolicy.svelte';
    import CookiePolicy from '$lib/components/CookiePolicy.svelte';
    import { onMount, onDestroy } from 'svelte';
    import { OPEN_PRIVACY_EVENT, OPEN_COOKIE_POLICY_EVENT } from '$lib/privacyCheckoutConsent.js';
    import { initApp, isGlobalLoading } from '$lib/stores.js'; // הוספת הייבוא של isGlobalLoading
    import { initAuth } from '$lib/authStore';
    import { fetchCurrentPrivacyPolicy } from '$lib/privacyPolicyStore.js';
 
    let isMenuOpen = false;
    let showPrivacy = false;
    let showCookiePolicy = false;
    let showAuth = false;

    function toggleMenu() {
        isMenuOpen = !isMenuOpen;
    }

    /** פתיחת מדיניות פרטיות מסל / checkout */
    function onOpenPrivacyEvent() {
        showPrivacy = true;
    }

    function onOpenCookiePolicyEvent() {
        showCookiePolicy = true;
    }

    /** iOS Safari: סרגל כתובות/כלי ניווט תחתון דינמי — מרחיק את ה-dock מעל האזור הנסתר */
    function updateVisualViewportChrome() {
        if (typeof document === 'undefined') return;
        const vv = window.visualViewport;
        if (!vv) {
            document.documentElement.style.setProperty('--vv-bottom-chrome', '0px');
            return;
        }
        const bottomObstruction = Math.max(0, window.innerHeight - vv.offsetTop - vv.height);
        document.documentElement.style.setProperty('--vv-bottom-chrome', `${bottomObstruction}px`);
    }

    onMount(() => {
        initApp();
        initAuth();
        fetchCurrentPrivacyPolicy();
        if (typeof window !== 'undefined') {
            window.addEventListener(OPEN_PRIVACY_EVENT, onOpenPrivacyEvent);
            window.addEventListener(OPEN_COOKIE_POLICY_EVENT, onOpenCookiePolicyEvent);

            updateVisualViewportChrome();
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', updateVisualViewportChrome);
                window.visualViewport.addEventListener('scroll', updateVisualViewportChrome);
            }
            window.addEventListener('resize', updateVisualViewportChrome);
        }
    });

    onDestroy(() => {
        if (typeof window !== 'undefined') {
            window.removeEventListener(OPEN_PRIVACY_EVENT, onOpenPrivacyEvent);
            window.removeEventListener(OPEN_COOKIE_POLICY_EVENT, onOpenCookiePolicyEvent);
            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', updateVisualViewportChrome);
                window.visualViewport.removeEventListener('scroll', updateVisualViewportChrome);
            }
            window.removeEventListener('resize', updateVisualViewportChrome);
        }
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
    <SideMenu 
        bind:isOpen={isMenuOpen} 
        on:openPrivacy={() => showPrivacy = true}
        on:openCookies={() => showCookiePolicy = true}
        on:openAuth={() => showAuth = true}
    />
    <PrivacyPolicy isOpen={showPrivacy} close={() => showPrivacy = false} />
    <CookiePolicy isOpen={showCookiePolicy} close={() => showCookiePolicy = false} />
    <AuthModal isOpen={showAuth} close={() => showAuth = false} />
    
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