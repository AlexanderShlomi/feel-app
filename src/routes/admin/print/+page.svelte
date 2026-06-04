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

  // ── Flat-nesting print pipeline ──────────────────────────────────────────────
  // Every tile (whether from a mosaic OR a magnet collection) is a hard
  // 50×50mm square — the operator cuts the printed A4 with a guillotine
  // into uniform 50mm magnets. We flatten ALL selected-order tiles into a
  // single array and chunk into fixed 3×5 = 15-tile A4-portrait pages for
  // maximum paper utilization across orders. Each printed tile carries a
  // tiny label so the operator can sort the cut pieces back to their source
  // order, and the customer (for mosaics) can reconstruct the puzzle.
  /** Pages produced by chunkTilesIntoPages — each holds <=15 mixed tiles. */
  let batchPages = [];

  let queue = [];
  let loading = true;
  let error = '';

  // Selection state — keyed by order id
  let selected = {};

  // Preview state
  /**
   * `previewReady`  – print-root has been mounted (so `<img>` tags exist in the
   *                   DOM and the browser started downloading their pixels).
   * `imagesReady`   – every `<img>` inside the print-root has fired `load` (or
   *                   exhausted its single retry). Only then is the printed
   *                   crop guaranteed to match the editor frame-for-frame.
   */
  let previewReady = false;
  let imagesReady = false;
  let loadingPreview = false;
  /** DOM ref to the print-root so we can scan its <img> children. */
  let printRootEl;

  // Data for rendering
  let itemsByOrder = {};
  let signedUrls = {};

  // Stats
  let utilization = 0;
  let pageCount = 0;

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

    // Auto-suggest
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
    // Selection changed → any previously-loaded preview no longer matches the
    // current selection. Invalidate so the user must reload before printing.
    previewReady = false;
    imagesReady = false;
  }

  function toggleOrder(id) {
    if (selected[id]) {
      delete selected[id];
    } else {
      selected[id] = true;
    }
    selected = selected; // trigger reactivity
    recalcLayout();
    previewReady = false;
    imagesReady = false;
  }

  function selectAll() {
    selected = {};
    for (const o of queue) selected[o.id] = true;
    selected = selected;
    recalcLayout();
    previewReady = false;
    imagesReady = false;
  }

  function selectNone() {
    selected = {};
    recalcLayout();
    previewReady = false;
    imagesReady = false;
  }

  function recalcLayout() {
    const selectedOrders = queue.filter(o => selected[o.id]);
    // Quick page-count estimate before originals are loaded. Final exact
    // count is computed in recomputeBatchLayout() once we know how many
    // tiles each mosaic actually expands into.
    const estimatedTiles = selectedOrders.reduce(
      (s, o) => s + (o.visible_tile_count || 0),
      0
    );
    pageCount = Math.ceil(estimatedTiles / ITEMS_PER_PAGE);
    utilization =
      pageCount > 0
        ? Math.round((estimatedTiles / (pageCount * ITEMS_PER_PAGE)) * 100)
        : 0;
  }

  /**
   * Build the exact batch pages from the loaded item data. Mosaics expand
   * into their cols×rows individual tiles (each with its cropRect index so
   * the customer can reconstruct the puzzle from the labels), magnets stay
   * as-is. All tiles flow into 3×5 = 15-per-A4 pages.
   */
  function recomputeBatchLayout() {
    const selectedOrders = queue.filter((o) => selected[o.id]);
    const tiles = flattenTilesForBatch(selectedOrders, itemsByOrder);
    batchPages = chunkTilesIntoPages(tiles, ITEMS_PER_PAGE);
    pageCount = batchPages.length;
    utilization =
      pageCount > 0
        ? Math.round((tiles.length / (pageCount * ITEMS_PER_PAGE)) * 100)
        : 0;
  }

  /**
   * Wait until every `<img>` inside `rootEl` has either fired `load` (with a
   * valid `naturalWidth`) or exhausted a single error-retry. This is what
   * makes "Load preview" trustworthy: before this gate, the print-root was
   * mounted but tiles were still in transit from Supabase Storage — the user
   * saw (and could print) the wrong crop. We also retry once on error with a
   * cache-buster so a transient network blip doesn't force the operator to
   * click "Load preview" repeatedly.
   */
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
          const onLoad = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            if (!retried) {
              retried = true;
              const src = img.getAttribute('src') || '';
              if (src) {
                const sep = src.includes('?') ? '&' : '?';
                // Re-assign src to force the browser to try the download
                // again — keeps the same signed token (still valid for 1h).
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

    // Reset visibility/print gates up front. Without this, a previous preview
    // remained on screen with stale signed URLs during the new fetch, and the
    // "Print" button stayed enabled — operator could print the wrong batch.
    loadingPreview = true;
    previewReady = false;
    imagesReady = false;
    error = '';

    // Get originals data from RPC
    const { data, error: rpcErr } = await supabase.rpc('admin_get_print_originals', {
      p_order_ids: selectedIds
    });

    if (rpcErr) {
      error = 'שגיאה בטעינת המקורות.';
      loadingPreview = false;
      return;
    }

    const items = Array.isArray(data) ? data : [];

    // Group items by order_id
    const grouped = {};
    const pathsToSign = new Set();

    for (const item of items) {
      const oid = item.order_id;
      if (!grouped[oid]) grouped[oid] = [];
      grouped[oid].push(item);

      // Collect all storage paths that need signing
      const paths = item.original_storage_paths || {};
      for (const p of Object.values(paths)) {
        if (p) pathsToSign.add(p);
      }
    }

    itemsByOrder = grouped;

    // Create signed URLs for all paths
    const urls = {};
    const pathArr = [...pathsToSign];

    // Batch in groups of 20 to avoid overwhelming the API
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

    // Build exact pages from real item data.
    recomputeBatchLayout();

    // Mount the print-root so <img> tags appear in the DOM and start
    // downloading. We keep `imagesReady = false` so the root stays visually
    // hidden (display:none) until every tile has actually loaded — display:none
    // does NOT suppress image downloads, so this gives us a clean "swap" with
    // no flash of half-rendered/wrong-crop tiles.
    previewReady = true;
    await tick();
    await waitForAllImagesToSettle(printRootEl);

    imagesReady = true;
    loadingPreview = false;
  }

  function handlePrint() {
    if (!previewReady) return;
    window.print();
  }

  let confirmingPrint = false;

  async function confirmPrinted() {
    const selectedIds = Object.keys(selected).filter(id => selected[id]);
    if (selectedIds.length === 0) return;

    confirmingPrint = true;
    const { error: rpcErr } = await supabase.rpc('admin_mark_orders_printed', {
      p_order_ids: selectedIds
    });

    if (rpcErr) {
      error = 'שגיאה בסימון ההדפסה.';
      confirmingPrint = false;
      return;
    }

    confirmingPrint = false;
    // Reload queue to reflect changes
    previewReady = false;
    imagesReady = false;
    batchPages = [];
    signedUrls = {};
    itemsByOrder = {};
    await loadQueue();
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

    <div class="sidebar-actions">
      <button class="admin-btn admin-btn--sm" on:click={applySuggestion} disabled={queue.length === 0}>
        הצעת אריזה אופטימלית
      </button>
      <button class="admin-btn admin-btn--ghost admin-btn--sm" on:click={selectAll}>בחר הכל</button>
      <button class="admin-btn admin-btn--ghost admin-btn--sm" on:click={selectNone}>נקה</button>
    </div>

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
        class="admin-btn admin-btn--primary"
        on:click={loadPreview}
        disabled={selectedCount === 0 || loadingPreview}
      >
        {loadingPreview ? 'טוען תצוגה…' : 'טען תצוגה מקדימה'}
      </button>
      <button
        class="admin-btn admin-btn--primary"
        on:click={handlePrint}
        disabled={!imagesReady}
      >
        🖨️ הדפס
      </button>
      <button
        class="admin-btn admin-btn--success"
        on:click={confirmPrinted}
        disabled={!imagesReady || confirmingPrint}
      >
        {confirmingPrint ? 'מסמן…' : '✓ אשר שההדפסה הושלמה'}
      </button>
    </div>

    {#if error}
      <p class="error-msg">{error}</p>
    {/if}

    <div class="print-hint">
      ✅ ההדפסה מוגדרת אוטומטית ל-A4 לאורך, ללא שוליים וללא scaling — לחץ הדפס.
    </div>

    {#if !imagesReady && pageCount > 0}
      <div class="placeholder-pages">
        {#each Array(pageCount) as _, pi}
          <div class="page-placeholder">
            <span>עמוד {pi + 1}</span>
            <span class="page-orders">≤ {ITEMS_PER_PAGE} אריחים</span>
          </div>
        {/each}
      </div>
    {/if}

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

  .sidebar-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
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
  .print-hint--warn {
    background: #ffe0b2;
    color: #6d4c00;
    font-weight: 600;
  }

  .placeholder-pages {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 20px;
  }

  .page-placeholder {
    width: 160px;
    height: 226px;
    background: #fafafa;
    border: 1px dashed #ccc;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: #888;
    gap: 6px;
  }

  .page-orders {
    font-size: 11px;
    text-align: center;
    padding: 0 6px;
    color: #aaa;
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
  .admin-btn--sm { padding: 5px 10px; font-size: 12px; }
  .admin-btn--ghost { border-color: transparent; color: #1976d2; }
  .admin-btn--primary { background: #1976d2; color: #fff; border-color: #1976d2; }
  .admin-btn--primary:hover:not(:disabled) { background: #1565c0; }
  .admin-btn--success { background: #388e3c; color: #fff; border-color: #388e3c; }
  .admin-btn--success:hover:not(:disabled) { background: #2e7d32; }

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
    .print-hint,
    .placeholder-pages {
      display: none !important;
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
      page-break-after: always;
      break-after: page;
    }
    .page-preview-wrapper:last-child {
      page-break-after: auto;
      break-after: auto;
    }

    /* Preserve filter colors (effects) on every printed node — without this
       most browsers strip background-color/filter to save ink. */
    :global(*) {
      print-color-adjust: exact !important;
      -webkit-print-color-adjust: exact !important;
    }
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
