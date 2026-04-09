<script>
    import { fade, fly } from 'svelte/transition';
    import {
        currentPrivacyPolicy,
        fetchCurrentPrivacyPolicy,
        privacyPolicyLoading
    } from '$lib/privacyPolicyStore.js';

    export let isOpen = false;
    export let close = () => {};

    $: lastUpdated =
        $currentPrivacyPolicy?.updated_at != null
            ? new Date($currentPrivacyPolicy.updated_at).toLocaleDateString('he-IL', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric'
              })
            : '—';

    /** ריענון בפתיחת המודאל (אחרי GRANT / עדכון ב-DB שלא רצו ב-layout) */
    $: if (isOpen) {
        void fetchCurrentPrivacyPolicy();
    }
</script>

{#if isOpen}
<div class="privacy-overlay" transition:fade={{ duration: 300 }} on:click|self={close}>
    <div class="privacy-modal theme-scroll" transition:fly={{ y: 60, duration: 500, opacity: 0 }}>
        
        <header class="privacy-header">
            <div class="brand-line">FEEL • LUXURY MEMORIES</div>
            <h2>מדיניות פרטיות – FEEL</h2>
            <div class="header-meta">
                {#if $currentPrivacyPolicy?.version}
                    <span class="update-date">גרסה {$currentPrivacyPolicy.version}</span>
                    <span class="meta-sep" aria-hidden="true"> · </span>
                {/if}
                <span class="update-date">עודכן לאחרונה: {lastUpdated}</span>
            </div>
            <button class="close-x-btn" on:click={close} aria-label="סגור">&times;</button>
        </header>

        <div class="privacy-body" dir="rtl">
            {#if $privacyPolicyLoading && !$currentPrivacyPolicy?.body}
                <p class="privacy-fetch-msg">טוען מדיניות…</p>
            {:else if $currentPrivacyPolicy?.body}
                {@html $currentPrivacyPolicy.body}
            {:else}
                <p class="privacy-fetch-msg">לא ניתן לטעון את מדיניות הפרטיות מהשרת.</p>
                <button type="button" class="retry-policy-btn" on:click={() => fetchCurrentPrivacyPolicy()}>
                    נסו שוב
                </button>
            {/if}
        </div>

        <footer class="privacy-footer">
            <button class="accept-btn" on:click={close}>הבנתי, בואו נמשיך</button>
        </footer>
    </div>
</div>
{/if}

<style>
    /* שכבת רקע כהה ומטושטשת - שומרת על עומק */
    .privacy-overlay {
        position: fixed;
        inset: 0;
        width: auto;
        height: auto;
        min-height: 100vh;
        min-height: 100dvh;
        background: rgba(13, 13, 13, 0.8);
        backdrop-filter: blur(20px);
        z-index: 9000;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 20px;
        box-sizing: border-box;
    }

    /* תיבת המודאל - צבע חול (Sand) מהפלטה */
    .privacy-modal {
        background: #f2f0ec;
        color: #475160;
        width: 100%;
        max-width: 800px;
        max-height: 85vh;
        max-height: 85dvh;
        border-radius: 30px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-height: 0;
        box-shadow: 0 40px 100px rgba(0, 0, 0, 0.3);
        position: relative;
    }

    /* כותרת - כהה, נקייה, משדרת ביטחון */
    .privacy-header {
        padding: 35px 40px 25px; text-align: center; 
        background: #EAE5DD; /* צבע חול קצת יותר כהה להדגשת הכותרת */
        border-bottom: 1px solid rgba(198, 178, 154, 0.3);
    }

    .brand-line { color: #846349; font-weight: 800; font-size: 10px; letter-spacing: 4px; margin-bottom: 10px; opacity: 0.8; }
    h2 { margin: 0; font-size: 26px; font-weight: 700; color: #1E2A38; /* Ink */ }
    
    .header-meta { margin-top: 8px; font-size: 12px; color: #888; }
    .meta-sep { opacity: 0.5; }
    .privacy-fetch-msg { text-align: center; padding: 2rem 1rem; font-weight: 600; color: #475160; }
    .retry-policy-btn {
        display: block; margin: 0 auto 2rem; padding: 12px 28px; border-radius: 50px;
        border: none; cursor: pointer; font-weight: 700; background: #C6B29A; color: #fff;
    }

    .close-x-btn {
        position: absolute; top: 25px; left: 25px; background: none; border: none;
        color: #846349; font-size: 38px; cursor: pointer; line-height: 1; transition: transform 0.2s;
    }
    .close-x-btn:hover { transform: scale(1.1); color: #1E2A38; }

    /* גוף המדיניות — :global כי התוכן מגיע מ-{@html} (DB) */
    .privacy-body {
        padding: 40px 45px;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
        text-align: right;
    }

    .privacy-body :global(section) { margin-bottom: 35px; }
    .privacy-body :global(h3) {
        color: #846349;
        font-size: 19px;
        margin-bottom: 15px;
        border-right: 4px solid #C6B29A;
        padding-right: 15px;
    }
    .privacy-body :global(p),
    .privacy-body :global(li) {
        font-size: 15px;
        line-height: 1.8;
        color: #475160;
        margin-bottom: 10px;
    }
    .privacy-body :global(ul) { padding-right: 20px; list-style: circle; }

    .privacy-body :global(.highlight-section) {
        background: rgba(198, 178, 154, 0.1);
        padding: 25px;
        border-radius: 18px;
        border: 1px solid rgba(198, 178, 154, 0.2);
    }
    .privacy-body :global(.biometric-alert) { color: #1e2a38; font-weight: 700; }

    .privacy-body :global(a) {
        color: #1e2a38;
        text-decoration: none;
        border-bottom: 1px solid transparent;
        transition: 0.2s;
        font-weight: 600;
    }
    .privacy-body :global(a:hover) { border-bottom-color: #1e2a38; }

    /* פוטר */
    .privacy-footer {
        flex-shrink: 0;
        padding: 30px;
        padding-bottom: max(30px, calc(30px + env(safe-area-inset-bottom, 0px)));
        background: #eae5dd;
        text-align: center;
        border-top: 1px solid rgba(198, 178, 154, 0.3);
    }

    /* כפתור אישור - נגיעת זהב/Dune (יוקרתי) */
    .accept-btn {
        background: #C6B29A; color: #FFFFFF; border: none; padding: 16px 60px;
        border-radius: 50px; font-weight: 800; font-size: 17px; cursor: pointer;
        transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        box-shadow: 0 4px 15px rgba(198, 178, 154, 0.3);
    }

    .accept-btn:hover { transform: translateY(-3px); box-shadow: 0 8px 25px rgba(198, 178, 154, 0.5); background: #846349; }

    @media (max-width: 768px) {
        .privacy-overlay {
            padding: 0;
            align-items: stretch;
        }
        .privacy-modal {
            height: 100vh;
            height: 100dvh;
            max-height: 100dvh;
            border-radius: 0;
        }
        .privacy-body {
            padding: 30px 25px;
        }
        h2 {
            font-size: 22px;
        }
        .close-x-btn {
            top: max(15px, env(safe-area-inset-top, 0px));
            left: max(15px, env(safe-area-inset-left, 0px));
        }
    }
</style>