<script>
    import { createEventDispatcher } from 'svelte';
    import { PRODUCT_TYPES, resetSystem } from '$lib/stores.js';
    import { goto } from '$app/navigation';
    import { user, profile, authLoading } from '$lib/authStore';
    import { supabase } from '$lib/supabase';

    export let isOpen = false;
    const dispatch = createEventDispatcher();

    $: displayName =
        $profile?.full_name?.trim() ||
        $user?.user_metadata?.full_name?.trim() ||
        $user?.user_metadata?.name?.trim() ||
        $user?.email ||
        '';

    let signOutBusy = false;

    async function handleSignOut(/** @type {MouseEvent} */ event) {
        event.stopPropagation();
        event.preventDefault();
        if (signOutBusy) return;
        signOutBusy = true;
        try {
            const { error } = await supabase.auth.signOut();
            if (error) console.error('signOut:', error);
        } catch (e) {
            console.error('signOut:', e);
        } finally {
            signOutBusy = false;
            closeMenu();
        }
    }

    function closeMenu() {
        isOpen = false;
    }

    // ניווט ליצירה חדשה
    function startCreation(type) {
        resetSystem(type);
        closeMenu();
        goto('/uploader');
    }

    function handleLegalClick(e, action) {
        e.preventDefault();
        dispatch(action); // פותח את המודאל המתאים ב-Layout
        closeMenu();
    }

    function openAuthModal() {
        dispatch('openAuth');
        closeMenu();
    }
</script>

<div id="side-menu" class:active={isOpen} aria-hidden={!isOpen}>
    {#if isOpen}
        <div
            class="menu-backdrop active"
            role="presentation"
            on:click={closeMenu}
        ></div>
    {/if}
    <div class="menu-header">
        <div class="header-right" aria-hidden="true"></div>
        <div class="header-center">
            <a href="/" class="logo" on:click={closeMenu}>
                <img src="/Logo.svg" alt="FEEL Logo" class="logo-img" loading="eager" decoding="async" />
            </a>
        </div>
        <div class="header-left">
            <button type="button" class="close-menu-btn" on:click={closeMenu} aria-label="סגור תפריט">&times;</button>
        </div>
    </div>

    <div class="menu-scroll-content theme-scroll">
        <div class="auth-section">
            {#if $authLoading}
                <div class="auth-user-card auth-loading" aria-busy="true">טוען…</div>
            {:else if $user}
                <div class="auth-user-card">
                    {#if $user.user_metadata?.avatar_url}
                        <img
                            class="user-avatar"
                            src={$user.user_metadata.avatar_url}
                            alt=""
                            width="40"
                            height="40"
                            loading="eager"
                            decoding="async"
                        />
                    {:else}
                        <div class="user-avatar user-avatar-fallback" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                        </div>
                    {/if}
                    <div class="user-text">
                        <span class="user-name">{displayName}</span>
                        {#if $user.email && displayName !== $user.email}
                            <span class="user-email">{$user.email}</span>
                        {/if}
                    </div>
                    <button
                        type="button"
                        class="logout-btn"
                        disabled={signOutBusy}
                        on:click|stopPropagation={handleSignOut}
                    >
                        {signOutBusy ? 'מתנתק…' : 'התנתקות'}
                    </button>
                </div>
            {:else}
                <button type="button" class="login-btn" on:click={openAuthModal}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    התחברות / הרשמה
                </button>
            {/if}
        </div>

        <nav class="nav-group">
            <span class="nav-group-heading">ליצור רגע חדש</span>
            <ul>
                <li>
                    <button type="button" on:click={() => startCreation(PRODUCT_TYPES.MAGNETS_PACK)}>
                        <svg class="nav-icon nav-icon--fill" viewBox="0 0 512 512" aria-hidden="true"><path d="M487.938,162.108l-224-128a16,16,0,0,0-15.876,0l-224,128a16,16,0,0,0,.382,28l224,120a16,16,0,0,0,15.112,0l224-120a16,16,0,0,0,.382-28ZM256,277.849,65.039,175.548,256,66.428l190.961,109.12Z"/><path d="M263.711,394.02,480,275.061V238.539L256,361.74,32,238.539v36.522L248.289,394.02a16.005,16.005,0,0,0,15.422,0Z"/><path d="M32,362.667,248.471,478.118a16,16,0,0,0,15.058,0L480,362.667V326.4L256,445.867,32,326.4Z"/></svg>
                        קולקציית תמונות
                    </button>
                </li>
                <li>
                    <button type="button" on:click={() => startCreation(PRODUCT_TYPES.MOSAIC)}>
                        <svg class="nav-icon nav-icon--fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 13v8h8v-8h-8zm6 6h-4v-4h4v4z"/></svg>
                        פסיפס זכרונות
                    </button>
                </li>
            </ul>
        </nav>

        <div class="separator"></div>

        <nav class="nav-group">
            <ul>
                <li>
                    <a href="/orders" on:click={closeMenu}>
                        <svg class="nav-icon nav-icon--stroke" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
                        ההזמנות שלי
                    </a>
                </li>
                <li>
                    <a href="/contact" on:click={closeMenu}>
                        <svg class="nav-icon nav-icon--stroke" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                        צור קשר
                    </a>
                </li>
            </ul>
        </nav>

        <div class="separator"></div>

        <nav class="nav-group legal-nav">
            <ul>
                <li><button type="button" on:click={(e) => handleLegalClick(e, 'openPrivacy')}>מדיניות פרטיות</button></li>
                <li><button type="button" on:click={(e) => handleLegalClick(e, 'openCookies')}>מדיניות קובצי Cookie</button></li>
                <li><a href="/privacy-choices">בחירות הפרטיות שלך</a></li>
                <li><a href="/terms">תנאי שימוש</a></li>
                <li><a href="/accessibility">נגישות</a></li>
            </ul>
        </nav>
    </div>
</div>

<style>
    #side-menu {
        position: fixed;
        top: 0;
        right: -300px;
        width: 300px;
        height: 100dvh;
        height: 100dvh;
        background: #ffffff;
        z-index: 6000;
        transition: right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        flex-direction: column;
        box-shadow: -10px 0 30px rgba(0, 0, 0, 0.05);
        box-sizing: border-box;
        pointer-events: none;
    }
    #side-menu.active {
        right: 0;
        pointer-events: auto;
    }

    /* אותו מבנה וגובה כמו .app-header (כולל border-box — בלי padding שמוסיף ל-70px) */
    .menu-header {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        align-items: center;
        padding: 10px 30px;
        background-color: var(--color-dark-blue);
        height: 70px;
        box-sizing: border-box;
        flex-shrink: 0;
        position: relative;
        z-index: 2;
    }
    .menu-header .header-right {
        justify-self: start;
    }
    .menu-header .header-center {
        justify-self: center;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100%;
    }
    .menu-header .header-left {
        justify-self: end;
    }
    .menu-header .logo {
        display: flex;
        align-items: center;
        height: 50px;
        text-decoration: none;
    }
    .menu-header .logo-img {
        height: 100%;
        width: auto;
        display: block;
    }
    .close-menu-btn {
        background: none;
        border: none;
        color: var(--color-gold);
        font-size: 32px;
        line-height: 1;
        cursor: pointer;
        padding: 4px 8px;
    }

    .menu-scroll-content {
        flex: 1;
        overflow-y: auto;
        scrollbar-gutter: stable;
        /* ריווח אופקי קטן: מונע חיתוך של border-radius ברקע hover בתוך אזור גלילה */
        padding: 20px 4px;
        min-height: 0;
        position: relative;
        z-index: 2;
        background: #ffffff;
    }

    /* אזור התחברות — 21px + 4px padding של המגירה ≈ 25px מהקצה */
    .auth-section {
        padding: 0 21px 25px;
    }
    .auth-user-card {
        display: flex; flex-direction: column; align-items: stretch; gap: 12px;
        padding: 14px; border-radius: 12px; background: var(--color-canvas-bg, #f5f5f5);
    }
    .auth-loading { text-align: center; font-weight: 600; color: var(--color-medium-blue-gray); padding: 14px; }
    .user-avatar {
        width: 40px; height: 40px; border-radius: 50%; object-fit: cover; align-self: center;
    }
    .user-avatar-fallback {
        display: flex; align-items: center; justify-content: center;
        background: var(--color-pink); color: white;
    }
    .user-avatar-fallback svg { width: 22px; height: 22px; }
    .user-text { text-align: center; }
    .user-name { display: block; font-weight: 700; font-size: 16px; color: var(--color-dark-blue, #1a1a2e); }
    .user-email { display: block; font-size: 13px; color: #777; margin-top: 4px; word-break: break-all; }
    .logout-btn {
        width: 100%;
        padding: 10px;
        border-radius: 10px;
        border: 1px solid #ddd;
        background: #fff;
        color: var(--color-medium-blue-gray);
        font-weight: 600;
        cursor: pointer;
        transition: 0.2s;
        position: relative;
        z-index: 1;
    }
    .logout-btn:hover:not(:disabled) {
        background: #fafafa;
        border-color: #ccc;
    }
    .logout-btn:disabled {
        opacity: 0.75;
        cursor: wait;
    }
    .login-btn {
        width: 100%; padding: 14px; border-radius: 12px; background: var(--color-pink);
        color: white; border: none; font-weight: 700; display: flex; align-items: center;
        justify-content: center; gap: 10px; cursor: pointer; transition: 0.2s;
    }
    .login-btn svg { width: 18px; }
    .login-btn:hover { opacity: 0.9; transform: translateY(-1px); }

    /* קבוצות ניווט — padding אופקי על הפריטים כדי שרקע hover יימתח על כל רוחב המגירה */
    .nav-group {
        padding: 10px 0;
    }
    .nav-group-heading {
        display: block;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        color: #999;
        margin: 0 0 10px 0;
        font-weight: 700;
        padding-inline: 21px;
        box-sizing: border-box;
    }
    .nav-group ul {
        list-style: none;
        padding: 0;
        margin: 0;
        width: 100%;
    }
    .nav-group li {
        margin-bottom: 4px;
        display: flex;
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
    }

    .nav-group :is(button, a) {
        flex: 1 1 auto;
        width: 100%;
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 21px;
        border-radius: 10px;
        text-decoration: none;
        font-size: 16px;
        font-weight: 600;
        background: transparent;
        border: none;
        cursor: pointer;
        text-align: end;
        margin: 0;
        appearance: none;
        -webkit-appearance: none;
        color: var(--color-medium-blue-gray);
        transition:
            background-color 0.2s ease,
            color 0.2s ease;
        -webkit-tap-highlight-color: transparent;
        justify-content: flex-start;
    }

    /* קישורים: אותו צבע לפני/אחרי ביקור — כדי שלא יישבר הובר */
    .nav-group a:link,
    .nav-group a:visited {
        color: var(--color-medium-blue-gray);
    }

    .nav-group :is(button, a):hover {
        background-color: color-mix(in srgb, var(--color-canvas-bg) 88%, var(--color-gold) 12%);
        color: var(--color-pink);
    }

    .nav-group :is(button, a):focus-visible {
        outline: 2px solid color-mix(in srgb, var(--color-pink) 55%, transparent);
        outline-offset: 2px;
    }

    .nav-icon {
        flex-shrink: 0;
        width: 22px;
        height: 22px;
        overflow: visible;
        box-sizing: content-box;
    }

    /* אייקונים ממולאים (מגנטים / פסיפס) */
    .nav-icon--fill {
        fill: currentColor;
        stroke: none;
    }

    /* אייקוני קו בלבד (הזמנות / צור קשר) */
    .nav-icon--stroke {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    .separator {
        height: 1px;
        background: #eee;
        margin: 15px 21px;
        box-sizing: border-box;
    }

    .legal-nav :is(button, a) {
        font-size: 14px;
        font-weight: 500;
        padding-block: 10px;
        padding-inline: 21px;
        color: #5a5a5a;
    }

    .legal-nav a:link,
    .legal-nav a:visited {
        color: #5a5a5a;
    }

    .legal-nav :is(button, a):hover {
        background-color: color-mix(in srgb, var(--color-canvas-bg) 88%, var(--color-gold) 12%);
        color: var(--color-pink);
    }

    .legal-nav :is(button, a):focus-visible {
        outline: 2px solid color-mix(in srgb, var(--color-pink) 55%, transparent);
        outline-offset: 2px;
    }

    .menu-backdrop {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(4px);
        z-index: 0;
        pointer-events: auto;
    }
</style>