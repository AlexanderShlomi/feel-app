<script>
  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import { fly, fade } from 'svelte/transition';

  /**
   * steps: Array<{
   *   id: string,
   *   selector: string,
   *   title?: string,
   *   text: string,
   *   placement?: 'top'|'bottom'|'left'|'right'|'auto',
   *   when?: () => boolean
   * }>
   */
  export let steps = [];
  export let isOpen = false;
  export let startAt = 0;

  const dispatch = createEventDispatcher();

  let idx = 0;
  let targetEl = null;
  let targetRect = null;
  let bubbleRect = null;
  let bubbleEl = null;

  let bubbleStyle = '';
  let highlightStyle = '';
  let placementResolved = 'bottom';

  function portal(node) {
    const target = document.body;
    target.appendChild(node);
    node.hidden = false;
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
    };
  }

  function getActiveStep() {
    const list = Array.isArray(steps) ? steps : [];
    const filtered = list.filter((s) => {
      try {
        return typeof s?.when === 'function' ? !!s.when() : true;
      } catch {
        return false;
      }
    });
    return { filtered, step: filtered[idx] || null };
  }

  async function resolveTargetAndPosition() {
    await tick();
    const { filtered, step } = getActiveStep();
    if (!isOpen || !step) return;

    // Clamp idx in case filtering changed.
    idx = Math.max(0, Math.min(idx, Math.max(0, filtered.length - 1)));

    targetEl = document.querySelector(step.selector);
    if (!targetEl) {
      // If target is missing (responsive layout etc), skip forward.
      if (idx < filtered.length - 1) {
        idx += 1;
        await resolveTargetAndPosition();
      } else {
        dispatch('close');
      }
      return;
    }

    targetRect = targetEl.getBoundingClientRect();
    if (targetEl.scrollIntoView) {
      try {
        targetEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      } catch {}
    }

    await tick();
    targetRect = targetEl.getBoundingClientRect();
    bubbleRect = bubbleEl?.getBoundingClientRect?.() || null;

    computeStyles(step);
  }

  function computeStyles(step) {
    if (!targetRect) return;

    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const pad = 10;
    const gap = 10;

    const bw = bubbleRect?.width || 280;
    const bh = bubbleRect?.height || 120;

    const cx = targetRect.left + targetRect.width / 2;
    const cy = targetRect.top + targetRect.height / 2;

    const candidates = [
      { p: 'bottom', x: cx - bw / 2, y: targetRect.bottom + gap },
      { p: 'top', x: cx - bw / 2, y: targetRect.top - gap - bh },
      { p: 'right', x: targetRect.right + gap, y: cy - bh / 2 },
      { p: 'left', x: targetRect.left - gap - bw, y: cy - bh / 2 }
    ];

    const preferred = (step.placement || 'auto');
    let order = candidates;
    if (preferred !== 'auto') {
      order = [
        candidates.find((c) => c.p === preferred),
        ...candidates.filter((c) => c.p !== preferred)
      ].filter(Boolean);
    }

    function score(c) {
      const x = Math.min(Math.max(pad, c.x), vw - bw - pad);
      const y = Math.min(Math.max(pad, c.y), vh - bh - pad);
      const fits =
        x >= pad &&
        y >= pad &&
        x + bw <= vw - pad &&
        y + bh <= vh - pad;
      const dx = Math.abs(c.x - x);
      const dy = Math.abs(c.y - y);
      // Prefer candidates that fit and need less clamping.
      return (fits ? 100000 : 0) - (dx * 10 + dy * 10);
    }

    const best = order.reduce((acc, c) => (score(c) > score(acc) ? c : acc), order[0]);
    placementResolved = best.p;

    const x = Math.min(Math.max(pad, best.x), vw - bw - pad);
    const y = Math.min(Math.max(pad, best.y), vh - bh - pad);

    bubbleStyle = `left:${Math.round(x)}px; top:${Math.round(y)}px;`;

    const hx = Math.round(targetRect.left - 6);
    const hy = Math.round(targetRect.top - 6);
    const hw = Math.round(targetRect.width + 12);
    const hh = Math.round(targetRect.height + 12);
    highlightStyle = `left:${hx}px; top:${hy}px; width:${hw}px; height:${hh}px;`;
  }

  function close() {
    dispatch('close');
  }

  function next() {
    const { filtered } = getActiveStep();
    if (idx >= filtered.length - 1) {
      close();
      return;
    }
    idx += 1;
    resolveTargetAndPosition();
  }

  function prev() {
    idx = Math.max(0, idx - 1);
    resolveTargetAndPosition();
  }

  function dontShowAgain() {
    dispatch('dismiss');
    close();
  }

  function handleKeydown(e) {
    if (!isOpen) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight' || e.key === 'Enter') next();
    if (e.key === 'ArrowLeft') prev();
  }

  $: if (isOpen) {
    idx = Math.max(0, startAt || 0);
    resolveTargetAndPosition();
  }

  onMount(() => {
    const onReflow = () => resolveTargetAndPosition();
    window.addEventListener('resize', onReflow, { passive: true });
    window.addEventListener('scroll', onReflow, { passive: true, capture: true });
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, { capture: true });
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  onDestroy(() => {
    targetEl = null;
    targetRect = null;
  });
</script>

{#if isOpen}
  <div class="cm-root" use:portal>
    <div class="cm-backdrop" transition:fade={{ duration: 140 }} on:click={close} aria-hidden="true"></div>
    <div class="cm-highlight" style={highlightStyle} aria-hidden="true"></div>

    <div
      class="cm-bubble"
      bind:this={bubbleEl}
      style={bubbleStyle}
      transition:fly={{ y: 6, duration: 220, opacity: 1 }}
      role="dialog"
      aria-modal="true"
      aria-label="הדרכה"
      tabindex="-1"
    >
      {#key idx}
        {#if getActiveStep().step}
          <div class="cm-head">
            <div class="cm-title">{getActiveStep().step.title || 'טיפ קצר'}</div>
            <button class="cm-x" on:click={close} aria-label="סגור">✕</button>
          </div>
          <div class="cm-text">{getActiveStep().step.text}</div>
          <div class="cm-actions">
            <button class="cm-btn ghost" on:click={dontShowAgain}>אל תראה שוב</button>
            <div class="cm-spacer"></div>
            <button class="cm-btn ghost" on:click={close}>דלג</button>
            <button class="cm-btn" on:click={next}>הבא</button>
          </div>
        {/if}
      {/key}
    </div>
  </div>
{/if}

<style>
  .cm-root {
    position: fixed;
    inset: 0;
    z-index: 99990;
    pointer-events: none;
    direction: rtl;
  }

  .cm-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(242, 240, 236, 0.55); /* Sand tint */
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    pointer-events: auto;
  }

  .cm-highlight {
    position: absolute;
    border-radius: 16px;
    box-shadow:
      0 0 0 2px rgba(63, 82, 79, 0.95),
      0 10px 30px rgba(0, 0, 0, 0.10);
    background: rgba(255, 255, 255, 0.35);
    pointer-events: none;
  }

  .cm-bubble {
    position: absolute;
    width: min(340px, calc(100vw - 24px));
    background: rgba(255, 255, 255, 0.97);
    border: 1px solid rgba(198, 178, 154, 0.65);
    border-radius: 18px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.14);
    padding: 12px 12px 10px;
    pointer-events: auto;
  }

  .cm-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    margin-bottom: 8px;
  }

  .cm-title {
    font-weight: 800;
    color: var(--color-medium-blue-gray);
    font-size: 14px;
    line-height: 1.2;
  }

  .cm-x {
    margin-inline-start: auto;
    border: none;
    background: transparent;
    cursor: pointer;
    color: rgba(0, 0, 0, 0.45);
    font-size: 18px;
    line-height: 1;
    padding: 6px 8px;
    border-radius: 10px;
  }
  .cm-x:hover { background: rgba(0, 0, 0, 0.05); }

  .cm-text {
    color: rgba(0, 0, 0, 0.72);
    font-weight: 600;
    font-size: 14px;
    line-height: 1.45;
  }

  .cm-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .cm-spacer { flex: 1; }

  .cm-btn {
    border: none;
    cursor: pointer;
    border-radius: 999px;
    padding: 8px 12px;
    font-weight: 800;
    font-size: 13px;
    background: var(--color-pink);
    color: #fff;
  }

  .cm-btn.ghost {
    background: transparent;
    color: var(--color-pink);
    border: 1px solid rgba(63, 82, 79, 0.25);
  }
  .cm-btn.ghost:hover {
    background: rgba(63, 82, 79, 0.06);
  }
</style>

