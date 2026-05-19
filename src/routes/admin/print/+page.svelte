<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import PrintPage from '$lib/admin/PrintPage.svelte';
  import PrintBatchPage from '$lib/admin/PrintBatchPage.svelte';
  import {
    packOrdersIntoPages,
    suggestOptimalBatch,
    pageNeedsLandscape,
    flattenTilesForBatch,
    chunkTilesIntoPages,
    ITEMS_PER_PAGE,
    USABLE_H_MM
  } from '$lib/admin/printPacking.js';

  /** Batch (nesting) mode: flatten ALL tiles → fixed-size pages with
   *  per-tile order labels. ON = maximize paper utilization (mixes orders
   *  on the same sheet). OFF = legacy per-order layout with order headers. */
  let batchMode = true;

  /** Flat array of tiles for the current selection (batch mode only). */
  let batchTiles = [];
  /** Pages produced by chunkTilesIntoPages for batch mode. */
  let batchPages = [];

  let queue = [];
  let loading = true;
  let error = '';

  // Selection state — keyed by order id
  let selected = {};

  // Preview state
  let previewPages = [];
  let previewReady = false;
  let loadingPreview = false;

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
  }

  function selectAll() {
    selected = {};
    for (const o of queue) selected[o.id] = true;
    selected = selected;
    recalcLayout();
    previewReady = false;
  }

  function selectNone() {
    selected = {};
    recalcLayout();
    previewReady = false;
  }

  function recalcLayout() {
    const selectedOrders = queue.filter(o => selected[o.id]);

    if (batchMode) {
      // Tile-count based estimate before originals are loaded. After
      // loadPreview() resolves, recomputeBatchLayout() refines using the
      // real items (mosaic expansion may push the count up).
      const estimatedTiles = selectedOrders.reduce(
        (s, o) => s + (o.visible_tile_count || 0),
        0
      );
      pageCount = Math.ceil(estimatedTiles / ITEMS_PER_PAGE);
      utilization =
        pageCount > 0
          ? Math.round((estimatedTiles / (pageCount * ITEMS_PER_PAGE)) * 100)
          : 0;
      // previewPages is only valid for legacy mode; keep it empty so the
      // legacy renderer doesn't accidentally fire.
      previewPages = [];
      return;
    }

    const pages = packOrdersIntoPages(selectedOrders);
    pageCount = pages.length;
    previewPages = pages;

    const totalUsed = pages.reduce((s, p) => s + p.usedHeight, 0);
    const totalCapacity = pages.length * USABLE_H_MM;
    utilization = totalCapacity > 0 ? Math.round((totalUsed / totalCapacity) * 100) : 0;
  }

  /** Rebuild the flat-batch pages once originals are loaded. Uses actual
   *  expanded tiles (mosaics → cells) instead of the visible_tile_count
   *  estimate so the page count is exact. */
  function recomputeBatchLayout() {
    const selectedOrders = queue.filter((o) => selected[o.id]);
    batchTiles = flattenTilesForBatch(selectedOrders, itemsByOrder);
    batchPages = chunkTilesIntoPages(batchTiles, ITEMS_PER_PAGE);
    pageCount = batchPages.length;
    const total = batchTiles.length;
    utilization =
      pageCount > 0 ? Math.round((total / (pageCount * ITEMS_PER_PAGE)) * 100) : 0;
  }

  function toggleBatchMode() {
    batchMode = !batchMode;
    previewReady = false;
    batchTiles = [];
    batchPages = [];
    recalcLayout();
  }

  async function loadPreview() {
    const selectedIds = Object.keys(selected).filter(id => selected[id]);
    if (selectedIds.length === 0) return;

    loadingPreview = true;
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

    // Refine page count for batch mode using the actual expanded tiles.
    if (batchMode) {
      recomputeBatchLayout();
    }

    // Wait for all images to be ready before enabling print
    previewReady = true;
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
    previewPages = [];
    batchTiles = [];
    batchPages = [];
    signedUrls = {};
    itemsByOrder = {};
    await loadQueue();
  }

  $: selectedCount = Object.keys(selected).filter(id => selected[id]).length;
  $: selectedTiles = queue
    .filter(o => selected[o.id])
    .reduce((s, o) => s + (o.visible_tile_count || 0), 0);
  /* Any page whose mosaic items are wider than 3 tiles must be printed on
     A4 landscape (3-col portrait can't physically fit a 4×3 mosaic row).
     Surfaces a hint to the admin so they pick the right printer setting. */
  $: needsLandscape =
    !batchMode &&
    previewReady &&
    Array.isArray(previewPages) &&
    previewPages.some((p) => pageNeedsLandscape(p, itemsByOrder));
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

    <label class="batch-toggle">
      <input type="checkbox" checked={batchMode} on:change={toggleBatchMode} />
      <span>איחוד הזמנות (Nesting) — {ITEMS_PER_PAGE} מגנטים/דף</span>
    </label>

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
        disabled={!previewReady}
      >
        🖨️ הדפס
      </button>
      <button
        class="admin-btn admin-btn--success"
        on:click={confirmPrinted}
        disabled={!previewReady || confirmingPrint}
      >
        {confirmingPrint ? 'מסמן…' : '✓ אשר שההדפסה הושלמה'}
      </button>
    </div>

    {#if error}
      <p class="error-msg">{error}</p>
    {/if}

    <div class="print-hint">
      ⚠️ לפני הדפסה: ודא שהמדפסת מוגדרת ל-A4 ללא scaling (100%).
    </div>

    {#if needsLandscape}
      <div class="print-hint print-hint--warn">
        ↩️ הדפסה זו כוללת פסיפס רחב מ-3 אריחים בשורה — נדרשת הדפסה ב-A4 לרוחב (Landscape).
      </div>
    {/if}

    {#if !previewReady && pageCount > 0}
      <div class="placeholder-pages">
        {#if batchMode}
          {#each Array(pageCount) as _, pi}
            <div class="page-placeholder">
              <span>עמוד {pi + 1}</span>
              <span class="page-orders">≤ {ITEMS_PER_PAGE} מגנטים</span>
            </div>
          {/each}
        {:else}
          {#each previewPages as page, pi}
            <div class="page-placeholder">
              <span>עמוד {pi + 1}</span>
              <span class="page-orders">
                {page.orders.map(o => `#${o.order_number}`).join(', ')}
              </span>
            </div>
          {/each}
        {/if}
      </div>
    {/if}

    <!-- Print root — this is what gets printed -->
    <div class="print-root" class:print-root--hidden={!previewReady}>
      {#if previewReady}
        {#if batchMode}
          {#each batchPages as page}
            <div class="page-preview-wrapper">
              <PrintBatchPage pageData={page} {signedUrls} />
            </div>
          {/each}
        {:else}
          {#each previewPages as page}
            {@const landscape = pageNeedsLandscape(page, itemsByOrder)}
            <div class="page-preview-wrapper" class:page-preview-wrapper--landscape={landscape}>
              <PrintPage pageData={page} {itemsByOrder} {signedUrls} />
            </div>
          {/each}
        {/if}
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

  .batch-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #444;
    background: #f5f5f5;
    padding: 6px 8px;
    border-radius: 4px;
    margin-bottom: 12px;
    cursor: pointer;
    user-select: none;
  }
  .batch-toggle input { margin: 0; }

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
  /* Landscape variant — for pages that contain a mosaic wider than 3 tiles.
     The inner .a4-page also flips dimensions (see PrintPage.svelte) so the
     admin sees the actual sheet orientation needed at the printer. */
  .page-preview-wrapper--landscape {
    width: 297mm;
    height: 210mm;
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
    .placeholder-pages,
    .batch-toggle {
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

  /* Use the whole sheet. size:auto lets the user pick A4/A3/Letter at the
     printer dialog; the inner .a4-page / .batch-page enforces 210x297mm. */
  @page {
    size: auto;
    margin: 0;
  }
</style>
