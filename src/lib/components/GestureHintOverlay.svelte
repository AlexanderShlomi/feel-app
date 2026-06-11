<script>
    import { onMount } from 'svelte';

    export let storageKey = 'gestureHint:default';
    export let active = true;

    let showAnimation = false;
    let showIcon = true;
    let prefersReduced = false;

    onMount(() => {
        prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const seen = sessionStorage.getItem(storageKey);
        if (!seen && !prefersReduced) {
            showAnimation = true;
            setTimeout(() => {
                showAnimation = false;
                sessionStorage.setItem(storageKey, '1');
            }, 2500);
        }
    });

    $: if (!active) {
        showAnimation = false;
    }
</script>

<div class="gesture-hint" aria-hidden="true">
    {#if showAnimation}
        <div class="anim-wrap" class:fade-out={!showAnimation}>
            <svg class="pinch-svg" viewBox="0 0 80 60" width="80" height="60" fill="none">
                <!-- Left finger -->
                <circle class="finger-l" cx="20" cy="30" r="8" fill="rgba(255,255,255,0.85)" stroke="rgba(63,82,79,0.9)" stroke-width="2"/>
                <!-- Right finger -->
                <circle class="finger-r" cx="60" cy="30" r="8" fill="rgba(255,255,255,0.85)" stroke="rgba(63,82,79,0.9)" stroke-width="2"/>
                <!-- Pan arrow -->
                <path class="pan-arrow" d="M35 48 L45 48 M41 44 L45 48 L41 52" stroke="rgba(198,178,154,0.95)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="anim-label">צבוט לזום · גרור להזזה</span>
        </div>
    {/if}

    {#if showIcon}
        <div class="static-icon" class:hidden={showAnimation}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
                <circle cx="7" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="17" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/>
                <path d="M10 12 L14 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M12 16 L12 20 M10 18 L12 20 L14 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
    {/if}
</div>

<style>
    .gesture-hint {
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 30;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
    }

    .anim-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        animation: hintFadeIn 0.2s ease-out forwards, hintFadeOut 0.3s ease-in 2.2s forwards;
        background: rgba(0,0,0,0.55);
        border-radius: 12px;
        padding: 10px 14px 8px;
    }

    .pinch-svg .finger-l {
        animation: fingerL 1.2s ease-in-out infinite alternate;
    }
    .pinch-svg .finger-r {
        animation: fingerR 1.2s ease-in-out infinite alternate;
    }
    .pinch-svg .pan-arrow {
        animation: panArrow 1.2s ease-in-out 0.6s infinite alternate;
    }

    @keyframes fingerL {
        from { transform: translateX(0); }
        to   { transform: translateX(10px); }
    }
    @keyframes fingerR {
        from { transform: translateX(0); }
        to   { transform: translateX(-10px); }
    }
    @keyframes panArrow {
        from { opacity: 0.3; transform: translateX(-4px); }
        to   { opacity: 1;   transform: translateX(4px); }
    }

    .anim-label {
        color: rgba(255,255,255,0.9);
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        direction: rtl;
    }

    @keyframes hintFadeIn {
        from { opacity: 0; transform: scale(0.9); }
        to   { opacity: 1; transform: scale(1); }
    }
    @keyframes hintFadeOut {
        from { opacity: 1; }
        to   { opacity: 0; }
    }

    .static-icon {
        color: rgba(63,82,79,0.8);
        background: rgba(255,255,255,0.75);
        border-radius: 50%;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(4px);
        transition: opacity 0.3s;
    }
    .static-icon.hidden {
        opacity: 0;
    }

    @media (prefers-reduced-motion: reduce) {
        .anim-wrap { display: none; }
    }
</style>
