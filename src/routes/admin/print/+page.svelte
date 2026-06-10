<script>
  import { onMount, tick } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import PrintBatchPage from '$lib/admin/PrintBatchPage.svelte';
  import {
    suggestOptimalBatch,
    flattenTilesForBatch,
    chunkTilesIntoPages,
    ITEMS_PER_PAGE
  } from '$lib/admin/printPacking.js';

  /** Pages produced by chunkTilesIntoPages — each holds <=15 mixed tiles. */
  let batchPages = [];

  let queue = [];
  let loading = true;
  let error = '';

  // Selection state — keyed by order id
  let selected = {};

  // Preview state
  let previewReady = false;
  let imagesReady = false;
  let loadingPreview = false;
  /** DOM ref to the print-root so we can scan its <img> children. */
  let printRootEl;

  // Data for rendering
  let itemsByOrder = {};
  /** Per-order production job overrides (gift crop, gift image path). */
  let jobsByOrder = {};
  let signedUrls = {};

  // Stats
  let utilization = 0;
  let pageCount = 0;

  // Debounce handle for auto-loading preview on selection change
  let previewDebounceTimer = null;

  onMount(loadQueue);

  async function loadQueue() {
    loading = true;
    error = '';
    const { data, error: rpcErr } = await supabase.rpc('admin_get_print_queue');
    if (rpcErr) {
      error = 'שגיאה בטעינת תור ההדפסה.';
      loading = false;
      return;
    }
    queue = Array.isArray(data) ? data : [];
    loading = false;

    if (queue.length > 0) {
      applySuggestion();
    }
  }

  function applySuggestion() {
    const result = suggestOptimalBatch(queue);
    selected = {};
    for (const id of result.selectedIds) {
      selected[id] = true;
    }
    recalcLayout();
    schedulePreviewLoad();
  }

  function toggleOrder(id) {
    if (selected[id]) {
      delete selected[id];
    } else {
      selected[id] = true;
    }
    selected = selected; // trigger reactivity
    recalcLayout();
    schedulePreviewLoad();
  }

  function recalcLayout() {
    const selectedOrders = queue.filter(o => selected[o.id]);
    const estimatedTiles = selectedOrders.reduce(
      (s, o) => s + (o.visible_tile_count || 0),
      0
    );
    pageCount = Math.ceil(estimatedTiles / ITEMS_PER_PAGE);
    utilization =
      pageCount > 0
        ? Math.round((estimatedTiles / (pageCount * ITEMS_PER_PAGE)) * 100)
        : 0;
    // Invalidate stale preview whenever selection changes.
    previewReady = false;
    imagesReady = false;
  }

  /** Debounce preview load so rapid toggles don't fire multiple RPCs. */
  function schedulePreviewLoad() {
    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(loadPreview, 300);
  }

  function recomputeBatchLayout() {
    const selectedOrders = queue.filter((o) => selected[o.id]);
    const tiles = flattenTilesForBatch(selectedOrders, itemsByOrder, jobsByOrder);
    batchPages = chunkTilesIntoPages(tiles, ITEMS_PER_PAGE);
    pageCount = batchPages.length;
    utilization =
      pageCount > 0
        ? Math.round((tiles.length / (pageCount * ITEMS_PER_PAGE)) * 100)
        : 0;
  }

  async function waitForAllImagesToSettle(rootEl) {
    if (!rootEl) return;
    const imgs = Array.from(rootEl.querySelectorAll('img'));
    await Promise.all(
      imgs.map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve) => {
          let retried = false;
          const cleanup = () => {
            img.removeEventListener('load', onLoad);
            img.removeEventListener('error', onError);
          };
          const onLoad = () => { cleanup(); resolve(); };
          const onError = () => {
            if (!retried) {
              retried = true;
              const src = img.getAttribute('src') || '';
              if (src) {
                const sep = src.includes('?') ? '&' : '?';
                img.setAttribute('src', `${src}${sep}_retry=1`);
              }
              return;
            }
            cleanup();
            resolve();
          };
          img.addEventListener('load', onLoad);
          img.addEventListener('error', onError);
        });
      })
    );
  }

  async function loadPreview() {
    const selectedIds = Object.keys(selected).filter(id => selected[id]);
    if (selectedIds.length === 0) return;

    loadingPreview = true;
    previewReady = false;
    imagesReady = false;
    error = '';

    const { data, error: rpcErr } = await supabase.rpc('admin_get_print_originals', {
      p_order_ids: selectedIds
    });

    if (rpcErr) {
      error = 'שגיאה בטעינת המקורות.';
      loadingPreview = false;
      return;
    }

    const items = Array.isArray(data) ? data : [];

    const grouped = {};
    const jobs = {};
    const pathsToSign = new Set();

    for (const item of items) {
      const oid = item.order_id;
      if (!grouped[oid]) grouped[oid] = [];
      grouped[oid].push(item);

      // Collect per-order job overrides (gift crop / image path).
      if (!jobs[oid]) {
        jobs[oid] = {
          gift_image_path: item.gift_image_path || null,
          overridden_gift_crop: item.overridden_gift_crop || null
        };
      }

      // Collect all storage paths that need signing.
      const paths = item.original_storage_paths || {};
      for (const p of Object.values(paths)) {
        if (p) pathsToSign.add(p);
      }
      // Also sign the admin gift image if present.
      if (item.gift_image_path) pathsToSign.add(item.gift_image_path);
    }

    itemsByOrder = grouped;
    jobsByOrder = jobs;

    const urls = {};
    const pathArr = [...pathsToSign];

    for (let i = 0; i < pathArr.length; i += 20) {
      const batch = pathArr.slice(i, i + 20);
      const promises = batch.map(async (path) => {
        const { data: signData } = await supabase.storage
          .from('order-originals')
          .createSignedUrl(path, 3600);
        if (signData?.signedUrl) {
          urls[path] = signData.signedUrl;
        }
      });
      await Promise.all(promises);
    }

    signedUrls = urls;
    recomputeBatchLayout();

    previewReady = true;
    await tick();
    await waitForAllImagesToSettle(printRootEl);

    imagesReady = true;
    loadingPreview = false;
  }

  let printing = false;
  let previewModalOpen = false;

  function openPreviewModal() {
    if (imagesReady) previewModalOpen = true;
  }

  function closePreviewModal() {
    previewModalOpen = false;
  }

  /**
   * Single "send to print" action:
   * 1. Opens the browser print dialog.
   * 2. Marks orders as printed only after the user confirms the print
   *    (via the `afterprint` event — fires even if they cancel, but
   *    that's acceptable; the admin can always re-print if needed).
   */
  async function sendToPrint() {
    if (!imagesReady || printing) return;

    printing = true;
    error = '';

    const selectedIds = Object.keys(selected).filter(id => selected[id]);

    // Wire up afterprint *before* calling print() so it fires for this session.
    const afterPrint = async () => {
      window.removeEventListener('afterprint', afterPrint);
      const { error: rpcErr } = await supabase.rpc('admin_mark_orders_printed', {
        p_order_ids: selectedIds
      });
      if (rpcErr) {
        error = 'שגיאה בסימון ההדפסה.';
      } else {
        previewReady = false;
        imagesReady = false;
        batchPages = [];
        signedUrls = {};
        itemsByOrder = {};
        jobsByOrder = {};
        await loadQueue();
      }
      printing = false;
    };

    window.addEventListener('afterprint', afterPrint);
    window.print();
  }

  $: selectedCount = Object.keys(selected).filter(id => selected[id]).length;
  $: selectedTiles = queue
    .filter(o => selected[o.id])
    .reduce((s, o) => s + (o.visible_tile_count || 0), 0);
</script>

<svelte:head>
  <title>FEEL Admin — הדפסה</title>
</svelte:head>

<div class="print-layout">
  <!-- Sidebar -->
  <aside class="print-sidebar">
    <h2 class="sidebar-title">תור הדפסה</h2>

    {#if selectedCount > 0}
      <div class="sidebar-stats">
        <span>{selectedCount} הזמנות</span>
        <span>{selectedTiles} מגנטים</span>
        <span>{pageCount} עמודים</span>
        <span class="util-badge" class:util-high={utilization >= 90}>
          {utilization}% ניצולת
        </span>
      </div>
    {/if}

    {#if loading}
      <p class="hint">טוען…</p>
    {:else if queue.length === 0}
      <p class="hint">אין הזמנות ממתינות להדפסה.</p>
    {:else}
      <ul class="order-list">
        {#each queue as order}
          <li class="order-item" class:order-item--selected={selected[order.id]}>
            <label class="order-label">
              <input
                type="checkbox"
                checked={!!selected[order.id]}
                on:change={() => toggleOrder(order.id)}
              />
              <span class="order-info">
                <strong>#{order.order_number}</strong>
                <span class="order-name">{order.shipping_first_name} {order.shipping_last_name}</span>
                <span class="order-tiles">{order.visible_tile_count} מגנטים</span>
              </span>
              {#if order.printed_at}
                <span class="printed-badge">הודפס</span>
              {/if}
            </label>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>

  <!-- Main area -->
  <main class="print-main">
    <div class="toolbar">
      <button
        class="admin-btn admin-btn--preview"
        on:click={openPreviewModal}
        disabled={!imagesReady}
        title="הצג תצוגה מקדימה של הדפים לפני ההדפסה"
      >
        👁️ תצוגה מקדימה
      </button>
      <button
        class="admin-btn admin-btn--primary"
        on:click={sendToPrint}
        disabled={!imagesReady || printing}
      >
        {#if loadingPreview}
          ⏳ טוען תצוגה…
        {:else if printing}
          🖨️ מדפיס…
        {:else}
          🖨️ שלח להדפסה
        {/if}
      </button>
    </div>

    {#if error}
      <p class="error-msg">{error}</p>
    {/if}

    <div class="print-hint">
      ✅ ההדפסה מוגדרת אוטומטית ל-A4 לאורך, ללא שוליים וללא scaling.
    </div>

    <!-- Print root — this is what gets printed -->
    <!--
      bind:this lets loadPreview() scan the mounted <img> tags and await their
      load events before flipping `imagesReady`. The `print-root--hidden` class
      is keyed on `imagesReady` (not `previewReady`) so the tree is mounted
      (images download) while remaining display:none until every tile is ready —
      preventing the "flash of wrong crop" the admin was seeing.
    -->
    <div class="print-root" class:print-root--hidden={!imagesReady} bind:this={printRootEl}>
      {#if previewReady}
        {#each batchPages as page}
          <div class="page-preview-wrapper">
            <PrintBatchPage pageData={page} {signedUrls} />
          </div>
        {/each}
      {/if}
    </div>
  </main>
</div>

<!-- Preview Modal -->
{#if previewModalOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="preview-modal-backdrop" on:click={closePreviewModal}>
    <div class="preview-modal" on:click|stopPropagation>
      <div class="preview-modal-header">
        <span class="preview-modal-title">תצוגה מקדימה — {pageCount} עמודים, {selectedTiles} מגנטים</span>
        <button class="preview-modal-close" on:click={closePreviewModal}>✕ סגור</button>
      </div>
      <div class="preview-modal-body">
        {#each batchPages as page, i}
          <div class="preview-modal-page">
            <div class="preview-modal-page-label">עמוד {i + 1} / {pageCount}</div>
            <div class="preview-modal-page-inner">
              <PrintBatchPage pageData={page} {signedUrls} />
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── Screen layout ───────────────────────────────────────────────────────── */
  .print-layout {
    display: flex;
    gap: 20px;
    max-width: 1400px;
    margin: 0 auto;
    min-height: calc(100vh - 80px);
  }

  .print-sidebar {
    width: 320px;
    flex-shrink: 0;
    border-left: 1px solid #e0e0e0;
    padding-left: 16px;
    overflow-y: auto;
    max-height: calc(100vh - 100px);
    position: sticky;
    top: 80px;
  }

  .sidebar-title {
    font-size: 18px;
    font-weight: 700;
    margin: 0 0 12px;
  }

  .sidebar-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
    font-size: 13px;
    color: #555;
  }

  .util-badge {
    background: #ffeeba;
    border-radius: 4px;
    padding: 1px 6px;
    font-weight: 600;
  }
  .util-high {
    background: #c8e6c9;
    color: #2e7d32;
  }

  .order-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .order-item {
    border-bottom: 1px solid #f0f0f0;
    padding: 6px 0;
  }
  .order-item--selected {
    background: #e3f2fd;
    border-radius: 4px;
    padding: 6px 4px;
  }

  .order-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 13px;
  }

  .order-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .order-name {
    color: #666;
    font-size: 12px;
  }

  .order-tiles {
    color: #999;
    font-size: 11px;
  }

  .printed-badge {
    font-size: 10px;
    background: #e0e0e0;
    border-radius: 3px;
    padding: 1px 5px;
    margin-right: auto;
    color: #555;
  }

  /* ── Main area ────────────────────────────────────────────────────────────── */
  .print-main {
    flex: 1;
    min-width: 0;
  }

  .toolbar {
    display: flex;
    gap: 10px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .error-msg {
    color: #e53935;
    font-size: 14px;
    margin-bottom: 10px;
  }

  .print-hint {
    font-size: 12px;
    color: #666;
    background: #fff8e1;
    padding: 6px 10px;
    border-radius: 4px;
    margin-bottom: 16px;
  }

  /* ── Preview pages ─────────────────────────────────────────────────────── */
  .print-root--hidden {
    display: none;
  }

  .page-preview-wrapper {
    margin-bottom: 24px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
    /* Scale A4 (210mm) to fit ~560px on screen */
    transform-origin: top right;
    transform: scale(var(--preview-scale, 0.67));
    width: 210mm;
    height: 297mm;
  }

  .hint {
    color: #888;
    font-size: 13px;
  }

  /* ── Button styles ──────────────────────────────────────────────────────── */
  .admin-btn {
    border: 1px solid #ccc;
    background: #fff;
    border-radius: 6px;
    padding: 8px 14px;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .admin-btn:hover:not(:disabled) { background: #f5f5f5; }
  .admin-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .admin-btn--primary { background: #1976d2; color: #fff; border-color: #1976d2; }
  .admin-btn--primary:hover:not(:disabled) { background: #1565c0; }

  /* ── Print media ─────────────────────────────────────────────────────────── */
  @media print {
    /* The "@media print revolution" — nuke EVERY admin chrome element. Only
       the print pages survive. Anything not under .print-root is hidden so
       no stray sidebar / toolbar / hint leaks onto the printed sheet. */
    :global(header),
    :global(nav),
    :global(footer),
    :global(.admin-sidebar),
    .print-sidebar,
    .toolbar,
    .error-msg,
    .print-hint {
      display: none !important;
    }

    .print-root {
      margin: 0;
      padding: 0;
      overflow: visible;
      display: block;
    }

    /* Neutralize the admin shell ancestors (root + admin layouts) so they
       don't eat into the printable page budget. Without this,
       `.admin-main`'s 24px padding (~6.35mm top+bottom) plus
       `.admin-shell`'s `min-height: 100vh` pad/inflate the print content;
       a full 286mm A4 page + ~12.7mm padding = ~298.7mm > 297mm, which
       spills each full page onto an extra (near-blank) physical sheet.
       This is independent of the browser's print-margin setting. */
    :global(.page-container) {
      margin: 0 !important;
      padding: 0 !important;
    }
    :global(.admin-shell) {
      min-height: 0 !important;
      display: block !important;
    }
    :global(.admin-main) {
      margin: 0 !important;
      padding: 0 !important;
      flex: none !important;
    }

    .print-layout {
      display: block;
      margin: 0;
      padding: 0;
      max-width: none;
      min-height: 0;
    }

    .print-main {
      margin: 0;
      padding: 0;
    }

    .print-root--hidden {
      display: block !important;
    }

    .page-preview-wrapper {
      transform: none !important;
      box-shadow: none;
      border: none;
      border-radius: 0;
      margin: 0;
      overflow: visible;
      /* Drop the exact 297mm screen height — @page fixes physical paper size;
         an inner element at exactly 297mm gets bumped to a second physical
         sheet by sub-pixel rounding in the print engine. */
      height: auto;
      /* Keep one logical page on one physical sheet. */
      break-inside: avoid;
      page-break-inside: avoid;
    }
    /* Break before every page except the first — avoids a trailing blank page
       that `page-break-after:always` + :last-child produces when Svelte
       inserts text nodes between wrappers (breaking :last-child matching). */
    .page-preview-wrapper + .page-preview-wrapper {
      page-break-before: always;
      break-before: page;
    }

    /* Preserve filter colors (effects) on every printed node — without this
       most browsers strip background-color/filter to save ink. */
    :global(*) {
      print-color-adjust: exact !important;
      -webkit-print-color-adjust: exact !important;
    }
  }

  /* ── Preview Modal ──────────────────────────────────────────────────────── */
  .admin-btn--preview {
    background: #fff;
    border-color: #1976d2;
    color: #1976d2;
  }
  .admin-btn--preview:hover:not(:disabled) { background: #e3f2fd; }

  .preview-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.65);
    z-index: 1000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    overflow-y: auto;
    padding: 24px 16px;
  }

  .preview-modal {
    background: #f5f5f5;
    border-radius: 8px;
    width: min(900px, 100%);
    box-shadow: 0 8px 40px rgba(0,0,0,0.3);
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 48px);
  }

  .preview-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid #ddd;
    background: #fff;
    border-radius: 8px 8px 0 0;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .preview-modal-title {
    font-size: 15px;
    font-weight: 600;
    color: #333;
  }

  .preview-modal-close {
    border: 1px solid #ccc;
    background: #fff;
    border-radius: 5px;
    padding: 5px 12px;
    font-size: 13px;
    cursor: pointer;
    color: #555;
  }
  .preview-modal-close:hover { background: #f5f5f5; color: #000; }

  .preview-modal-body {
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 28px;
    align-items: center;
  }

  .preview-modal-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: 100%;
  }

  .preview-modal-page-label {
    font-size: 12px;
    color: #777;
    font-weight: 500;
  }

  .preview-modal-page-inner {
    /* Scale A4 (210mm ≈ 794px) to fit modal width.
       Modal body is ~860px; 860/794 ≈ 1.08 but we keep ≤1 to avoid upscaling.
       Use transform-origin so the scaled element doesn't shift left. */
    transform-origin: top center;
    transform: scale(var(--modal-page-scale, 0.72));
    width: 210mm;
    height: 297mm;
    box-shadow: 0 2px 16px rgba(0,0,0,0.15);
    border: 1px solid #e0e0e0;
    border-radius: 2px;
    overflow: hidden;
    background: white;
    /* collapsed height after scale — keeps the stacking gap accurate */
    margin-bottom: calc(297mm * (var(--modal-page-scale, 0.72) - 1));
  }

  @media print {
    .preview-modal-backdrop { display: none !important; }
  }

  /* Force A4 portrait at the @page level so the browser print dialog opens
     with the correct paper size selected and ZERO margins — the admin does
     NOT need to fiddle with print settings. Both .batch-page (the printed
     A4) and @page declare 210x297mm, eliminating any browser default
     header/footer band that would otherwise shrink the usable area and
     force scaling. */
  @page {
    size: A4 portrait;
    margin: 0;
  }
</style>
