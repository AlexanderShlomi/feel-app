<script>
  export let effects = [];
  export let activeId = 'original';
  export let onSelect = () => {};
  export let size = 'md'; // 'sm' | 'md'

  $: thumbPx = size === 'sm' ? 46 : 60;
</script>

<div class="effects-row" role="list" aria-label="אפקטים">
  {#each effects as effect (effect.id)}
    <button
      type="button"
      class="effect-btn"
      class:active={effect.id === activeId}
      on:click={() => onSelect(effect.id)}
      role="listitem"
      aria-pressed={effect.id === activeId}
      aria-label={`בחר אפקט: ${effect.name}`}
    >
      <div class="thumb" aria-hidden="true" style="width: {thumbPx}px; height: {thumbPx}px;">
        <img
          src="/effects.png"
          alt=""
          style="filter: {effect.css};"
          loading="lazy"
          decoding="async"
          fetchpriority="low"
          width={thumbPx}
          height={thumbPx}
        />
      </div>
      <span class="label">{effect.name}</span>
    </button>
  {/each}
</div>

<style>
  .effects-row {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 10px;
    width: min(92vw, 520px);
    max-width: 100%;
    padding: 2px;
    box-sizing: border-box;
  }

  .effect-btn {
    appearance: none;
    border: 0;
    background: transparent;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    min-width: 0;
    color: var(--color-medium-blue-gray);
    font-family: 'Assistant', sans-serif;
  }

  .thumb {
    border-radius: 10px;
    overflow: hidden;
    border: 2px solid rgba(0, 0, 0, 0.08);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
    box-sizing: border-box;
    flex: 0 0 auto;
    background: rgba(255, 255, 255, 0.65);
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .label {
    font-size: 12px;
    font-weight: 700;
    line-height: 1.1;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .effect-btn.active .thumb {
    border-color: var(--color-pink);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12);
  }

  @media (min-width: 769px) {
    .effects-row {
      width: min(92vw, 620px);
      gap: 14px;
    }
    .label {
      font-size: 13px;
    }
  }
</style>
