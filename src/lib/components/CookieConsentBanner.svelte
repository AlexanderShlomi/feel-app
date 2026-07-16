<script>
    import { onMount, onDestroy } from 'svelte';
    import { fade, fly } from 'svelte/transition';
    import {
        hasDecision,
        acceptAll,
        rejectAll,
        saveConsent,
        cookieConsent,
        OPEN_COOKIE_SETTINGS_EVENT
    } from '$lib/consentStore.js';
    import {
        requestOpenCookiePolicy,
        requestOpenPrivacyPolicy
    } from '$lib/privacyCheckoutConsent.js';
    import { scheduleIdle } from '$lib/utils/idle.js';

    /** האם הרכיב מוצג */
    let visible = false;
    /** 'banner' = ביקור ראשון · 'manage' = ניהול העדפות */
    let mode = 'banner';
    /** האם המשתמש כבר הכריע (קובע אם ניתן לסגור בלי בחירה) */
    let decided = false;

    // העדפות מקומיות (necessary תמיד פעיל)
    let analyticsOn = false;
    let adsOn = false;
    let socialOn = false;

    function loadCurrent() {
        const c = $cookieConsent?.categories || {};
        analyticsOn = !!c.analytics;
        adsOn = !!c.ads;
        socialOn = !!c.social;
    }

    function openManager() {
        decided = hasDecision();
        loadCurrent();
        mode = 'manage';
        visible = true;
    }

    function onAcceptAll() {
        acceptAll();
        visible = false;
    }

    function onRejectAll() {
        rejectAll();
        visible = false;
    }

    function onSavePrefs() {
        saveConsent({ analytics: analyticsOn, ads: adsOn, social: socialOn });
        visible = false;
    }

    function onCustomize() {
        loadCurrent();
        mode = 'manage';
    }

    function closeIfAllowed() {
        // בביקור ראשון אסור לסגור בלי בחירה; לאחר הכרעה (פתיחה מהתפריט) מותר
        if (decided) visible = false;
    }

    function openCookiePolicy() {
        requestOpenCookiePolicy();
    }
    function openPrivacyPolicy() {
        requestOpenPrivacyPolicy();
    }

    let cancelIdleShow = () => {};
    onMount(() => {
        // עולה רק לאחר idle כדי לא לפגוע ב-FCP/LCP
        const show = () => {
            if (!hasDecision()) {
                decided = false;
                mode = 'banner';
                loadCurrent();
                visible = true;
            }
        };
        cancelIdleShow = scheduleIdle(show, { timeout: 2500, fallbackDelay: 800 });
        window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, openManager);
    });

    onDestroy(() => {
        if (typeof window === 'undefined') return;
        window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, openManager);
        cancelIdleShow();
    });
</script>

{#if visible}
    <div class="cc-root" dir="rtl">
        {#if mode === 'manage'}
            <!-- מסך אישור עם רקע מעומעם -->
            <div
                class="cc-overlay"
                transition:fade={{ duration: 200 }}
                role="presentation"
                on:click|self={closeIfAllowed}
            ></div>
        {/if}

        <div
            class="cc-panel"
            class:cc-panel--manage={mode === 'manage'}
            role={mode === 'manage' ? 'dialog' : 'region'}
            aria-modal={mode === 'manage'}
            aria-label="הגדרות עוגיות ופרטיות"
            transition:fly={{ y: 80, duration: 380, opacity: 0 }}
        >
            {#if mode === 'banner'}
                <div class="cc-head">
                    <span class="cc-brand">FEEL • LUXURY MEMORIES</span>
                    <h2 class="cc-title">אנחנו מכבדים את הפרטיות שלך 🍪</h2>
                </div>
                <p class="cc-text">
                    אנו משתמשים בעוגיות הכרחיות לתפעול האתר, ובכפוף להסכמתך גם בעוגיות
                    <strong>אנליטיקה</strong>, <strong>פרסום</strong> ו<strong>מעקב חברתי</strong>
                    כדי לשפר את החוויה ולהתאים תוכן. ניתן לשנות בחירה בכל עת.
                    <button type="button" class="cc-inline-link" on:click={openCookiePolicy}>מדיניות עוגיות</button>
                    ·
                    <button type="button" class="cc-inline-link" on:click={openPrivacyPolicy}>מדיניות פרטיות</button>
                </p>
                <div class="cc-actions">
                    <button type="button" class="cc-btn cc-btn--primary" on:click={onAcceptAll}>אשר הכל</button>
                    <button type="button" class="cc-btn cc-btn--ghost" on:click={onRejectAll}>דחה הכל</button>
                    <button type="button" class="cc-btn cc-btn--text" on:click={onCustomize}>התאמה אישית</button>
                </div>
            {:else}
                <header class="cc-manage-head">
                    <div>
                        <span class="cc-brand">FEEL • LUXURY MEMORIES</span>
                        <h2 class="cc-title">הגדרות עוגיות</h2>
                    </div>
                    {#if decided}
                        <button type="button" class="cc-close" on:click={closeIfAllowed} aria-label="סגור">&times;</button>
                    {/if}
                </header>

                <div class="cc-categories theme-scroll">
                    <div class="cc-cat">
                        <div class="cc-cat-text">
                            <span class="cc-cat-name">עוגיות הכרחיות</span>
                            <span class="cc-cat-desc">חיוניות לתפעול: שמירת סל, סביבת עריכה, אבטחה והתחברות. תמיד פעילות.</span>
                        </div>
                        <span class="cc-locked">תמיד פעיל</span>
                    </div>

                    <label class="cc-cat">
                        <div class="cc-cat-text">
                            <span class="cc-cat-name">אנליטיקה</span>
                            <span class="cc-cat-desc">מדידת שימוש וביצועים (Google Analytics) כדי לשפר את החוויה.</span>
                        </div>
                        <span class="cc-switch"><input type="checkbox" bind:checked={analyticsOn} /><span class="cc-track"></span></span>
                    </label>

                    <label class="cc-cat">
                        <div class="cc-cat-text">
                            <span class="cc-cat-name">פרסום ושיווק מחדש</span>
                            <span class="cc-cat-desc">התאמת מודעות וייחוס קמפיינים (Meta, TikTok, Google Ads).</span>
                        </div>
                        <span class="cc-switch"><input type="checkbox" bind:checked={adsOn} /><span class="cc-track"></span></span>
                    </label>

                    <label class="cc-cat">
                        <div class="cc-cat-text">
                            <span class="cc-cat-name">מעקב חברתי</span>
                            <span class="cc-cat-desc">פיקסלים של רשתות חברתיות לשיתוף וייחוס מדויק יותר.</span>
                        </div>
                        <span class="cc-switch"><input type="checkbox" bind:checked={socialOn} /><span class="cc-track"></span></span>
                    </label>
                </div>

                <div class="cc-actions cc-actions--manage">
                    <button type="button" class="cc-btn cc-btn--primary" on:click={onSavePrefs}>שמור העדפות</button>
                    <button type="button" class="cc-btn cc-btn--ghost" on:click={onAcceptAll}>אשר הכל</button>
                    <button type="button" class="cc-btn cc-btn--text" on:click={onRejectAll}>דחה הכל</button>
                </div>
                <p class="cc-foot-links">
                    <button type="button" class="cc-inline-link" on:click={openCookiePolicy}>מדיניות עוגיות</button>
                    ·
                    <button type="button" class="cc-inline-link" on:click={openPrivacyPolicy}>מדיניות פרטיות</button>
                </p>
            {/if}
        </div>
    </div>
{/if}

<style>
    .cc-root {
        position: fixed;
        inset: 0;
        z-index: 8900; /* מתחת למודאלי המדיניות (9000) כדי שייפתחו מעל הבאנר, ומעל שאר התוכן */
        pointer-events: none;
    }
    .cc-overlay {
        position: fixed;
        inset: 0;
        background: rgba(13, 13, 13, 0.55);
        backdrop-filter: blur(6px);
        pointer-events: auto;
    }

    .cc-panel {
        position: fixed;
        left: 50%;
        bottom: 0;
        transform: translateX(-50%);
        width: min(640px, 100%);
        box-sizing: border-box;
        background: #f2f0ec;
        color: #475160;
        border-radius: 22px 22px 0 0;
        box-shadow: 0 -18px 50px rgba(0, 0, 0, 0.22);
        padding: 22px 24px;
        padding-bottom: max(22px, calc(22px + env(safe-area-inset-bottom, 0px)));
        pointer-events: auto;
        border-top: 3px solid #c6b29a;
    }
    @media (min-width: 700px) {
        .cc-panel:not(.cc-panel--manage) {
            bottom: 18px;
            border-radius: 20px;
            border-top: none;
            border: 1px solid rgba(198, 178, 154, 0.45);
        }
    }
    .cc-panel--manage {
        max-height: 86dvh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .cc-brand {
        display: block;
        color: #846349;
        font-weight: 800;
        font-size: 10px;
        letter-spacing: 3px;
        margin-bottom: 6px;
    }
    .cc-title {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        color: #1e2a38;
        line-height: 1.35;
    }
    .cc-head {
        margin-bottom: 10px;
    }
    .cc-text {
        font-size: 14px;
        line-height: 1.75;
        margin: 0 0 16px;
        color: #475160;
    }

    .cc-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
    }
    .cc-actions--manage {
        margin-top: 16px;
    }
    .cc-btn {
        border: none;
        cursor: pointer;
        font-weight: 800;
        font-size: 14px;
        border-radius: 50px;
        padding: 13px 26px;
        transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        flex: 1 1 auto;
        min-height: 44px;
    }
    .cc-btn--primary {
        background: #3f524f;
        color: #fff;
        box-shadow: 0 4px 14px rgba(63, 82, 79, 0.3);
    }
    .cc-btn--primary:hover {
        transform: translateY(-2px);
        background: #34433f;
    }
    .cc-btn--ghost {
        background: transparent;
        color: #475160;
        border: 1px solid rgba(71, 81, 96, 0.35);
    }
    .cc-btn--ghost:hover {
        background: rgba(71, 81, 96, 0.06);
    }
    .cc-btn--text {
        background: transparent;
        color: #846349;
        text-decoration: underline;
        text-underline-offset: 3px;
        flex: 0 1 auto;
        padding: 13px 16px;
    }
    .cc-btn--text:hover {
        color: #1e2a38;
    }

    .cc-inline-link {
        display: inline;
        padding: 0;
        border: none;
        background: none;
        color: #846349;
        font: inherit;
        font-weight: 700;
        text-decoration: underline;
        text-underline-offset: 3px;
        cursor: pointer;
    }
    .cc-inline-link:hover {
        color: #1e2a38;
    }

    /* ─── Manage mode ─── */
    .cc-manage-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 14px;
    }
    .cc-close {
        background: none;
        border: none;
        color: #846349;
        font-size: 32px;
        line-height: 1;
        cursor: pointer;
    }
    .cc-categories {
        overflow-y: auto;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .cc-cat {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 14px 16px;
        background: #fff;
        border: 1px solid rgba(198, 178, 154, 0.3);
        border-radius: 14px;
        cursor: pointer;
    }
    .cc-cat-text {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .cc-cat-name {
        font-weight: 700;
        font-size: 15px;
        color: #1e2a38;
    }
    .cc-cat-desc {
        font-size: 13px;
        line-height: 1.6;
        color: #6b7280;
    }
    .cc-locked {
        flex-shrink: 0;
        font-size: 12px;
        font-weight: 700;
        color: #846349;
        background: rgba(198, 178, 154, 0.18);
        padding: 6px 12px;
        border-radius: 50px;
    }

    /* toggle switch */
    .cc-switch {
        flex-shrink: 0;
        position: relative;
        display: inline-block;
        width: 48px;
        height: 28px;
    }
    .cc-switch input {
        position: absolute;
        opacity: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        cursor: pointer;
    }
    .cc-track {
        position: absolute;
        inset: 0;
        background: #cfcabf;
        border-radius: 50px;
        transition: background 0.2s;
    }
    .cc-track::before {
        content: '';
        position: absolute;
        top: 3px;
        right: 3px;
        width: 22px;
        height: 22px;
        background: #fff;
        border-radius: 50%;
        transition: transform 0.2s;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    }
    .cc-switch input:checked + .cc-track {
        background: #3f524f;
    }
    .cc-switch input:checked + .cc-track::before {
        transform: translateX(-20px);
    }
    .cc-switch input:focus-visible + .cc-track {
        outline: 2px solid color-mix(in srgb, #3f524f 55%, transparent);
        outline-offset: 2px;
    }

    .cc-foot-links {
        margin: 12px 0 0;
        font-size: 13px;
        text-align: center;
    }

    @media (max-width: 480px) {
        .cc-panel {
            padding: 18px 16px;
            padding-bottom: max(18px, calc(18px + env(safe-area-inset-bottom, 0px)));
        }
        .cc-btn {
            flex: 1 1 100%;
        }
        .cc-btn--text {
            flex: 1 1 100%;
        }
    }
</style>
