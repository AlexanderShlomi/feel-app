<script>
    import { fromStore } from 'svelte/store';
    import { page, navigating } from '$app/stores';
    import '../app.css'; 
    import Header from '$lib/components/Header.svelte';
    import SideMenu from '$lib/components/SideMenu.svelte';
    import AuthModal from '$lib/components/AuthModal.svelte';
    import PrivacyPolicy from '$lib/components/PrivacyPolicy.svelte';
    import CookiePolicy from '$lib/components/CookiePolicy.svelte';
    import { onMount, onDestroy, setContext } from 'svelte';
    import { OPEN_PRIVACY_EVENT, OPEN_COOKIE_POLICY_EVENT } from '$lib/privacyCheckoutConsent.js';
    import { initApp, isBlockingUi, bindEngine } from '$lib/stores.js';
    import { createFeelEngine, FEEL_ENGINE_KEY } from '$lib/engine/FeelEngine.svelte.js';
    import { setItem } from '$lib/utils/idb.js';
    import { initAuth } from '$lib/authStore';
    import { fetchCurrentPrivacyPolicy } from '$lib/privacyPolicyStore.js';

    const feelEngine = createFeelEngine();
    setContext(FEEL_ENGINE_KEY, feelEngine);
    bindEngine(feelEngine);

    const CART_DB_KEY = 'feel_cart_db_v1';

    $effect(() => {
        void feelEngine.magnets;
        void feelEngine.editorSettings;
        feelEngine.triggerAutoSave();
    });

    $effect(() => {
        void feelEngine.cart;
        setItem(CART_DB_KEY, feelEngine.cart).catch((e) => console.error('DB Save Error:', e));
    });

    /** @type {{ siteUrl: string }} */
    let { data } = $props();

    const siteTitle = 'FEEL - LUXURY MEMORIES';
    const siteDescription = 'לעצור את הזמן – להרגיש את הרגע';

    const siteBase = $derived((data?.siteUrl ?? '').replace(/\/$/, ''));
    const ogImageAbsolute = $derived(siteBase ? `${siteBase}/FeelLogo.svg` : '');
    const pageRef = fromStore(page);
    const canonicalUrl = $derived.by(() => {
        const p = pageRef.current;
        const base = (data?.siteUrl ?? '').replace(/\/$/, '');
        return base && p?.url ? `${base}${p.url.pathname}${p.url.search}` : '';
    });

    let isMenuOpen = false;
    let showPrivacy = false;
    let showCookiePolicy = false;
    let showAuth = false;

    // Mobile-first UX: avoid loader flicker on quick operations.
    // Show only if loading lasts long enough, and keep visible for a minimum duration.
    let showGlobalLoader = false;
    let loaderVisibleSince = 0;
    let loaderShowTimer;
    let loaderHideTimer;
    const LOADER_SHOW_DELAY_MS = 160;
    const LOADER_MIN_VISIBLE_MS = 260;

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

    let dockResizeObserver;
    let dockMutationObserver;
    let dockScheduled = false;

    function computeDockPadPx() {
        if (typeof document === 'undefined') return 0;
        const docks = Array.from(document.querySelectorAll('.glass-dock'));
        if (!docks.length) return 0;

        let maxPad = 0;
        for (const el of docks) {
            const rect = el.getBoundingClientRect();
            if (!rect || rect.height <= 0 || rect.width <= 0) continue;
            // How much of the viewport is covered from the dock's top to the bottom.
            const pad = Math.max(0, window.innerHeight - rect.top) + 8; // small breathing room
            if (pad > maxPad) maxPad = pad;
        }
        return Math.round(maxPad);
    }

    function scheduleDockPadUpdate() {
        if (dockScheduled) return;
        dockScheduled = true;
        requestAnimationFrame(() => {
            dockScheduled = false;
            const pad = computeDockPadPx();
            document.documentElement.style.setProperty('--dock-pad', `${pad}px`);
        });
    }

    function initDockPadObservers() {
        if (typeof document === 'undefined') return;
        scheduleDockPadUpdate();

        dockResizeObserver = new ResizeObserver(() => scheduleDockPadUpdate());
        const observeCurrent = () => {
            const docks = Array.from(document.querySelectorAll('.glass-dock'));
            docks.forEach((el) => {
                try { dockResizeObserver.observe(el); } catch {}
            });
        };
        observeCurrent();

        dockMutationObserver = new MutationObserver(() => {
            observeCurrent();
            scheduleDockPadUpdate();
        });
        dockMutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

        window.addEventListener('resize', scheduleDockPadUpdate);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', scheduleDockPadUpdate);
            window.visualViewport.addEventListener('scroll', scheduleDockPadUpdate);
        }
    }

    onMount(() => {
        initApp();
        initAuth();
        fetchCurrentPrivacyPolicy();
        const unsub = isBlockingUi.subscribe((loading) => {
            // Clear any pending timers first.
            if (loaderShowTimer) clearTimeout(loaderShowTimer);
            if (loaderHideTimer) clearTimeout(loaderHideTimer);

            if (loading) {
                loaderShowTimer = setTimeout(() => {
                    loaderVisibleSince = Date.now();
                    showGlobalLoader = true;
                }, LOADER_SHOW_DELAY_MS);
                return;
            }

            const elapsed = Date.now() - loaderVisibleSince;
            const remaining = Math.max(0, LOADER_MIN_VISIBLE_MS - elapsed);
            loaderHideTimer = setTimeout(() => {
                showGlobalLoader = false;
                loaderVisibleSince = 0;
            }, remaining);
        });

        if (typeof window !== 'undefined') {
            window.addEventListener(OPEN_PRIVACY_EVENT, onOpenPrivacyEvent);
            window.addEventListener(OPEN_COOKIE_POLICY_EVENT, onOpenCookiePolicyEvent);

            updateVisualViewportChrome();
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', updateVisualViewportChrome);
                window.visualViewport.addEventListener('scroll', updateVisualViewportChrome);
            }
            window.addEventListener('resize', updateVisualViewportChrome);

            initDockPadObservers();
        }

        return () => {
            try { unsub?.(); } catch {}
            if (loaderShowTimer) clearTimeout(loaderShowTimer);
            if (loaderHideTimer) clearTimeout(loaderHideTimer);
        };
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

            try { dockResizeObserver?.disconnect?.(); } catch {}
            try { dockMutationObserver?.disconnect?.(); } catch {}
            window.removeEventListener('resize', scheduleDockPadUpdate);
            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', scheduleDockPadUpdate);
                window.visualViewport.removeEventListener('scroll', scheduleDockPadUpdate);
            }
        }
    });
</script>

<svelte:head>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <meta name="theme-color" content="#1E1E1E" />

    <meta property="og:site_name" content="feel" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="he_IL" />
    <meta property="og:title" content={siteTitle} />
    <meta property="og:description" content={siteDescription} />
    {#if ogImageAbsolute}
        <meta property="og:image" content={ogImageAbsolute} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="feel – LUXURY MEMORIES · לעצור את הזמן – להרגיש את הרגע" />
    {/if}
    {#if canonicalUrl}
        <meta property="og:url" content={canonicalUrl} />
    {/if}

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={siteTitle} />
    <meta name="twitter:description" content={siteDescription} />
    {#if ogImageAbsolute}
        <meta name="twitter:image" content={ogImageAbsolute} />
    {/if}
</svelte:head>

<div class="page-container" dir="rtl">
    {#if $navigating}
        <div class="route-nav-progress" aria-hidden="true">
            <div class="route-nav-progress__bar"></div>
        </div>
    {/if}

    {#if showGlobalLoader}
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
    /* מענה מיידי לניווט (SvelteKit navigating store) — פס מותג דק בראש המסך */
    .route-nav-progress {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        z-index: 10020;
        pointer-events: none;
        overflow: hidden;
    }
    .route-nav-progress__bar {
        height: 100%;
        width: 100%;
        transform-origin: 0 50%;
        animation: routeNavIndeterminate 0.9s ease-in-out infinite;
        background: linear-gradient(90deg, var(--color-pink), var(--color-gold), rgb(71, 81, 96), var(--color-pink));
        background-size: 200% 100%;
    }
    @keyframes routeNavIndeterminate {
        0% { transform: scaleX(0.18); opacity: 0.85; }
        50% { transform: scaleX(0.72); opacity: 1; }
        100% { transform: scaleX(0.22); opacity: 0.9; }
    }

    /* 🔥 עיצוב הלאודר הגלובלי */
    .global-loader-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100dvh;
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