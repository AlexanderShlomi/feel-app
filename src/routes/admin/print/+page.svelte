<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import PrintBatchPage from '$lib/admin/PrintBatchPage.svelte';
  import PrintManifest from '$lib/admin/PrintManifest.svelte';
  import MosaicReference from '$lib/admin/MosaicReference.svelte';
  import {
    suggestOptimalBatch,
    flattenTilesForBatch,
    chunkTilesIntoPages,
    collectMosaicRefs,
    collectTileIssues,
    groupIssuesByOrder,
    countTilesByOrder,
    ordersOnPage,
    buildBatchManifest,
    ITEMS_PER_PAGE
  } from '$lib/admin/printPacking.js';
  import {
    trackPrintEvent,
    summariseIssueReasons,
    PRINT_EVENTS
  } from '$lib/admin/printTelemetry.js';

  /** Pages produced by chunkTilesIntoPages — each holds <=15 mixed tiles. */
  let batchPages = [];

  /**
   * Assembled-mosaic references for the preview modal. The cutting sheet nests
   * tiles 3-across, so a 4/5-column mosaic never reconstructs visually on
   * paper — these let the admin confirm the source image, crop and effect at a
   * glance before committing to print. Screen only.
   */
  let mosaicRefs = [];

  let queue = [];
  let loading = true;
  /** Transient: cleared by every queue/preview load. */
  let error = '';
  /**
   * Persistent until dismissed. Outcomes that touched real order rows must
   * survive the queue refresh and the preview reload that follow them —
   * `error` does not.
   */
  let notice = '';

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
  /** Per-order production job overrides (gift crop/image, greeting, notes). */
  let jobsByOrder = {};
  let signedUrls = {};

  /** Work-order rows printed after the sheets (see PrintManifest.svelte). */
  let manifest = [];

  // ── Tile integrity ─────────────────────────────────────────────────────────
  // A tile with no usable image renders as a placeholder square, and a
  // placeholder has no <img>, so it never blocked `imagesReady`: the batch went
  // to paper and the guillotine turned it into a blank magnet nobody noticed
  // until the customer opened the box. Broken tiles are now collected and the
  // print is blocked until they are resolved or explicitly overridden.

  /** Storage paths whose <img> failed to decode even after one retry. */
  let failedImagePaths = new Set();
  /** @type {ReturnType<typeof collectTileIssues>} */
  let tileIssues = [];
  /** Real tile count per order id, for the estimate-vs-truth comparison. */
  let actualByOrder = {};
  /** Admin explicitly chose to print despite broken tiles. */
  let overrideIssues = false;

  $: issuesByOrder = groupIssuesByOrder(tileIssues);

  // ── Signed-URL freshness ───────────────────────────────────────────────────
  // Signed URLs live for SIGNED_URL_TTL_S. An admin who left the tab open and
  // printed an hour later got a sheet of blank squares: the images 404'd long
  // after waitForAllImagesToSettle had passed. Track when the batch was signed
  // and refuse to print once it is close to expiry.
  const SIGNED_URL_TTL_S = 3600;
  const URL_STALE_AFTER_MS = 40 * 60 * 1000;

  /** Epoch ms when the current signedUrls map was created; 0 = none. */
  let signedAt = 0;
  /** Ticker so staleness re-evaluates without a user interaction. */
  let nowTs = Date.now();
  let freshnessTimer = null;

  $: urlsStale = signedAt > 0 && nowTs - signedAt > URL_STALE_AFTER_MS;

  // ── Load progress ──────────────────────────────────────────────────────────
  // Signing runs in serial batches of 20 and the images are full-resolution
  // originals, so a large batch can sit on "טוען…" for minutes. Without a
  // denominator the admin cannot tell progress from a hang, and reloading
  // throws away everything done so far.
  /** 'signing' | 'images' | '' */
  let progressPhase = '';
  let progressDone = 0;
  let progressTotal = 0;

  /** Fired once per batch, so the reactive staleness flag can't spam the log. */
  let expiryLogged = false;

  /** Ids the batch suggestion had to leave out because they overflow maxPages. */
  let suggestionSkippedIds = [];
  /** The oldest order alone exceeds the page budget. */
  let suggestionExceeds = false;

  // ── Stats: ONE source of truth ─────────────────────────────────────────────
  // Previously `recalcLayout()` wrote pageCount/utilization from the queue's
  // `visible_tile_count` estimate and `recomputeBatchLayout()` then overwrote
  // them with the real flattened count, so the numbers visibly jumped and the
  // modal header could state a tile count that disagreed with what was
  // actually being printed. Now there is a single derived chain: the estimate
  // is used only until the real tiles exist, and the UI says which one it is.
  /** Real tile count once the originals RPC has resolved; null before that. */
  let actualTiles = null;

  $: selectedOrders = queue.filter((o) => selected[o.id]);
  $: estimatedTiles = selectedOrders.reduce((s, o) => s + (o.visible_tile_count || 0), 0);
  $: tileCount = actualTiles ?? estimatedTiles;
  /** True while showing the queue estimate rather than the flattened truth. */
  $: tileCountIsEstimate = actualTiles === null && tileCount > 0;
  $: pageCount = Math.ceil(tileCount / ITEMS_PER_PAGE);
  $: utilization =
    pageCount > 0 ? Math.round((tileCount / (pageCount * ITEMS_PER_PAGE)) * 100) : 0;
  /** Blank slots on the last sheet — actionable where a bare percentage is not. */
  $: emptySlots = pageCount > 0 ? pageCount * ITEMS_PER_PAGE - tileCount : 0;

  // Debounce handle for auto-loading preview on selection change
  let previewDebounceTimer = null;

  /**
   * Monotonic id for preview loads. The 300ms debounce does not prevent two
   * in-flight RPCs overlapping (a slow originals fetch plus a fast one), and
   * whichever resolved last used to win regardless of which was requested
   * last. Every async continuation now checks it is still the newest request.
   */
  let previewRequestId = 0;

  onMount(() => {
    loadQueue();
    // Staleness must become true on its own: the admin who walks away and comes
    // back an hour later performs no interaction that would re-derive it.
    freshnessTimer = setInterval(() => { nowTs = Date.now(); }, 60000);
  });

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
    suggestionSkippedIds = result.skippedIds ?? [];
    suggestionExceeds = result.exceedsMaxPages === true;
    invalidatePreview();
    schedulePreviewLoad();
  }

  /** Select every order in the queue, page budget notwithstanding. */
  function selectAll() {
    const next = {};
    for (const order of queue) next[order.id] = true;
    selected = next;
    suggestionSkippedIds = [];
    suggestionExceeds = false;
    invalidatePreview();
    schedulePreviewLoad();
  }

  function clearSelection() {
    selected = {};
    suggestionSkippedIds = [];
    suggestionExceeds = false;
    invalidatePreview();
    schedulePreviewLoad();
  }

  function toggleOrder(id) {
    if (selected[id]) {
      delete selected[id];
    } else {
      selected[id] = true;
      // Manually adding an order the suggestion skipped resolves its notice.
      suggestionSkippedIds = suggestionSkippedIds.filter((sid) => sid !== id);
    }
    selected = selected; // trigger reactivity
    invalidatePreview();
    schedulePreviewLoad();
  }

  /**
   * Drop everything derived from the previous selection. Stats fall back to the
   * queue estimate until the originals RPC resolves again.
   */
  function invalidatePreview() {
    actualTiles = null;
    previewReady = false;
    imagesReady = false;
    // Integrity verdict and freshness belong to the batch that produced them;
    // carrying either into a new selection would either hide a fresh problem or
    // block on a stale one.
    tileIssues = [];
    actualByOrder = {};
    failedImagePaths = new Set();
    overrideIssues = false;
    signedAt = 0;
    expiryLogged = false;
    progressPhase = '';
    progressDone = 0;
    progressTotal = 0;
  }

  // Expiry is reached by the clock, not by a user action, so it is logged from
  // a reactive statement — guarded so it records the event once per batch.
  $: if (urlsStale && !expiryLogged) {
    expiryLogged = true;
    trackPrintEvent(PRINT_EVENTS.URLS_EXPIRED, {
      tiles: tileCount,
      pages: pageCount,
      orders: selectedCount
    });
  }

  /** Debounce preview load so rapid toggles don't fire multiple RPCs. */
  function schedulePreviewLoad() {
    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(loadPreview, 300);
  }

  function recomputeBatchLayout() {
    const orders = queue.filter((o) => selected[o.id]);
    const tiles = flattenTilesForBatch(orders, itemsByOrder, jobsByOrder);
    batchPages = chunkTilesIntoPages(tiles, ITEMS_PER_PAGE);
    mosaicRefs = collectMosaicRefs(orders, itemsByOrder);
    actualByOrder = countTilesByOrder(tiles);
    manifest = buildBatchManifest(orders, itemsByOrder, jobsByOrder, actualByOrder);
    // First integrity pass: paths that are missing or were never signed. A
    // second pass runs after the images settle, adding decode failures.
    tileIssues = collectTileIssues(tiles, signedUrls, failedImagePaths);
    // Publishing the real count flips every derived stat off the estimate.
    actualTiles = tiles.length;
  }

  /** Re-run the integrity pass over the current sheets. */
  function recheckTileIssues() {
    const tiles = batchPages.flatMap((p) => p.tiles);
    tileIssues = collectTileIssues(tiles, signedUrls, failedImagePaths);
  }

  /**
   * Await every <img> under `rootEl` and report which ones never decoded.
   *
   * Previously this resolved on error and told the caller nothing, so a failed
   * download was indistinguishable from a successful one and `imagesReady`
   * went true either way. The returned set feeds collectTileIssues.
   *
   * @returns {Promise<Set<string>>} storage paths that failed after one retry
   */
  async function waitForAllImagesToSettle(rootEl) {
    const failed = new Set();
    if (!rootEl) return failed;
    const imgs = Array.from(rootEl.querySelectorAll('img'));

    progressPhase = 'images';
    progressDone = 0;
    progressTotal = imgs.length;

    await Promise.all(
      imgs.map((img) => {
        const settled = () => { progressDone += 1; };
        if (img.complete && img.naturalWidth > 0) {
          settled();
          return Promise.resolve();
        }
        return new Promise((resolve) => {
          let retried = false;
          const cleanup = () => {
            img.removeEventListener('load', onLoad);
            img.removeEventListener('error', onError);
          };
          const onLoad = () => { cleanup(); settled(); resolve(); };
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
            // data-path is set by PrintBatchPage; it survives the retry rewrite
            // of src, which is why the tile is identified by path and not URL.
            const path = img.dataset?.path;
            if (path) failed.add(path);
            // Counted as settled either way: this is a progress bar, not a
            // success rate — a stuck denominator would read as a hang.
            settled();
            resolve();
          };
          img.addEventListener('load', onLoad);
          img.addEventListener('error', onError);
        });
      })
    );
    return failed;
  }

  async function loadPreview() {
    const selectedIds = Object.keys(selected).filter(id => selected[id]);
    if (selectedIds.length === 0) {
      // Nothing selected: clear any stale sheets rather than leaving the
      // previous batch on screen next to a zeroed sidebar.
      batchPages = [];
      mosaicRefs = [];
      manifest = [];
      loadingPreview = false;
      return;
    }

    const requestId = ++previewRequestId;
    /** A newer load started while we were awaiting: discard this result. */
    const isStale = () => requestId !== previewRequestId;

    loadingPreview = true;
    previewReady = false;
    imagesReady = false;
    error = '';

    const { data, error: rpcErr } = await supabase.rpc('admin_get_print_originals', {
      p_order_ids: selectedIds
    });

    if (isStale()) return;

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

      // Collect per-order job data: gift overrides plus the text the work-order
      // sheet prints (greeting already coalesced with the admin override
      // server-side, and the admin notes).
      if (!jobs[oid]) {
        jobs[oid] = {
          gift_image_path: item.gift_image_path || null,
          overridden_gift_crop: item.overridden_gift_crop || null,
          gift_message: item.gift_message || '',
          admin_notes: item.admin_notes || ''
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

    progressPhase = 'signing';
    progressDone = 0;
    progressTotal = pathArr.length;

    for (let i = 0; i < pathArr.length; i += 20) {
      const batch = pathArr.slice(i, i + 20);
      const promises = batch.map(async (path) => {
        const { data: signData } = await supabase.storage
          .from('order-originals')
          .createSignedUrl(path, SIGNED_URL_TTL_S);
        if (signData?.signedUrl) {
          urls[path] = signData.signedUrl;
        }
        // A path that fails to sign is deliberately left out of the map:
        // collectTileIssues reports it as `no_url` rather than it becoming an
        // anonymous grey square.
        progressDone += 1;
      });
      await Promise.all(promises);
      // Signing a large batch takes many round trips; bail out early rather
      // than finish work for a selection the admin has already changed.
      if (isStale()) return;
    }

    signedUrls = urls;
    failedImagePaths = new Set();
    signedAt = Date.now();
    nowTs = signedAt;
    recomputeBatchLayout();

    previewReady = true;
    await tick();
    const failed = await waitForAllImagesToSettle(printRootEl);

    if (isStale()) return;

    // Second integrity pass: decode failures are only knowable now.
    failedImagePaths = failed;
    recheckTileIssues();

    // The headline operational metric: how often a batch cannot be printed
    // because an original is missing. Logged per batch, not per tile.
    if (tileIssues.length > 0) {
      trackPrintEvent(PRINT_EVENTS.BLOCKED_BY_ISSUES, {
        issue_count: tileIssues.length,
        affected_orders: issuesByOrder.length,
        tiles: actualTiles ?? 0,
        reasons: summariseIssueReasons(tileIssues)
      });
    }

    progressPhase = '';
    imagesReady = true;
    loadingPreview = false;
  }

  let previewModalOpen = false;

  // ── Print lifecycle ────────────────────────────────────────────────────────
  // 'idle'      nothing in flight
  // 'dialog'    window.print() called, browser dialog is open
  // 'confirm'   dialog closed, waiting for the admin to say whether it worked
  // 'marking'   admin_mark_orders_printed RPC in flight
  /** @type {'idle' | 'dialog' | 'confirm' | 'marking'} */
  let printPhase = 'idle';
  $: printing = printPhase !== 'idle';

  /** Order ids captured when the dialog opened, so a later selection change
   *  cannot redirect the "mark printed" write to the wrong orders. */
  let printBatchIds = [];

  /**
   * Which subtree the next print job emits.
   *
   * The two outputs go on DIFFERENT MEDIA: the cutting sheets are printed on
   * magnetic stock, the work order is plain text. Emitting both from one
   * `window.print()` burned a full sheet of the expensive stock on text every
   * batch — one print job means one paper tray. They are now separate,
   * optional actions so the operator can change paper between them.
   *
   * @type {'sheets' | 'manifest'}
   */
  let printTarget = 'sheets';

  /** Safety net: `afterprint` is reliable in current browsers but not
   *  guaranteed. Without this the UI could sit disabled forever. */
  let afterPrintTimer = null;
  let detachAfterPrint = null;
  const AFTER_PRINT_TIMEOUT_MS = 180000; // 3 min: a long dialog is still valid

  /**
   * Everything that must hold before paper is allowed to move.
   * Broken tiles block unless the admin explicitly overrides; expired signed
   * URLs block unconditionally, because "print it anyway" there means printing
   * a sheet of 404s.
   */
  $: printBlockedByIssues = tileIssues.length > 0 && !overrideIssues;
  $: canPrint = imagesReady && !printing && !urlsStale && !printBlockedByIssues;

  /**
   * Admin accepts that some tiles will print blank and unblocks the batch.
   * Worth measuring on its own: a rising override rate means the integrity
   * check is being worked around rather than the uploads being fixed.
   */
  function acceptBrokenTiles() {
    overrideIssues = true;
    trackPrintEvent(PRINT_EVENTS.OVERRIDE_USED, {
      issue_count: tileIssues.length,
      affected_orders: issuesByOrder.length,
      reasons: summariseIssueReasons(tileIssues)
    });
  }

  function openPreviewModal() {
    if (!imagesReady) return;
    previouslyFocusedEl = document.activeElement;
    previewModalOpen = true;
  }

  /** Element focused before the modal opened, restored on close. */
  let previouslyFocusedEl = null;
  /** The modal panel, focused on open so keyboard users land inside it. */
  let previewModalEl;

  function closePreviewModal() {
    previewModalOpen = false;
    // Return focus to whatever opened the modal instead of dumping the user at
    // the top of the document.
    previouslyFocusedEl?.focus?.();
    previouslyFocusedEl = null;
  }

  /** Global Escape handling: the modal previously had no keyboard exit at all. */
  function onWindowKeydown(e) {
    if (e.key === 'Escape' && previewModalOpen) {
      e.preventDefault();
      closePreviewModal();
    }
  }

  // Move focus into the panel once it mounts.
  $: if (previewModalOpen && previewModalEl) previewModalEl.focus();

  /**
   * Open the print dialog, then ASK before recording the result.
   *
   * Why the extra step: the browser fires `afterprint` when the dialog closes
   * whether the admin printed or cancelled, and exposes no way to tell the two
   * apart. The previous code marked the orders `printed` unconditionally, so
   * cancelling the dialog silently advanced real orders to a state they had
   * never reached. Order status is business data, so we take the explicit
   * confirmation instead of guessing.
   */
  async function sendToPrint() {
    if (!imagesReady || printing) return;

    // The signed URLs behind every tile expire an hour after signing. Printing
    // past that point produced a full batch of blank squares with no warning,
    // because the image check had passed long before. Re-sign instead.
    if (urlsStale) {
      error = 'קישורי התמונות פגו — התצוגה נטענת מחדש. נסה שוב בעוד רגע.';
      invalidatePreview();
      schedulePreviewLoad();
      return;
    }

    if (printBlockedByIssues) {
      error = 'יש אריחים ללא תמונה. תקן אותם או אשר הדפסה בכל זאת.';
      return;
    }

    error = '';
    printBatchIds = Object.keys(selected).filter((id) => selected[id]);
    if (printBatchIds.length === 0) return;

    // Cutting sheets only — the work order is a separate job on plain paper.
    printTarget = 'sheets';

    trackPrintEvent(PRINT_EVENTS.BATCH_SENT, {
      orders: printBatchIds.length,
      tiles: tileCount,
      pages: pageCount,
      utilization,
      empty_slots: emptySlots,
      mosaics: mosaicRefs.length,
      // True only when the admin pushed past the integrity block.
      with_broken_tiles: tileIssues.length
    });

    printPhase = 'dialog';

    const onAfterPrint = () => {
      teardownAfterPrint();
      // Dialog closed. We cannot know if paper came out: ask.
      printPhase = 'confirm';
    };

    // Register before print() so the event is caught for this invocation.
    window.addEventListener('afterprint', onAfterPrint);
    detachAfterPrint = () => window.removeEventListener('afterprint', onAfterPrint);
    afterPrintTimer = setTimeout(onAfterPrint, AFTER_PRINT_TIMEOUT_MS);

    // Same reason as printManifestOnly: flush the DOM before the synchronous
    // print(). Usually a no-op here because 'sheets' is the resting state — but
    // if a work-order print left printTarget on 'manifest' (afterprint is not
    // guaranteed to fire), skipping this would send paperwork to the magnetic
    // stock instead of the batch.
    await tick();

    window.print();
  }

  /** Restore timer for the standalone work-order print. */
  let manifestPrintTimer = null;

  /**
   * Print the work order on its own — optional, at the admin's discretion.
   *
   * Deliberately NOT part of the batch lifecycle: it opens no confirmation and
   * writes no order status, because paperwork coming out of a printer says
   * nothing about whether magnets did. It is also NOT gated on tile integrity —
   * a batch with a missing image is precisely when the operator may want the
   * paperwork in hand to work out what is wrong.
   */
  async function printManifestOnly() {
    if (manifest.length === 0 || printing) return;
    error = '';
    printTarget = 'manifest';

    // MUST await the DOM before printing. Svelte flushes class changes in a
    // microtask, but window.print() is synchronous — without this it captured
    // the PREVIOUS DOM, in which the cutting sheets were still visible, and the
    // "work order" job came out as a duplicate of the sheets.
    await tick();

    const restore = () => {
      window.removeEventListener('afterprint', restore);
      clearTimeout(manifestPrintTimer);
      manifestPrintTimer = null;
      // Back to the default so a later Ctrl+P or batch print emits sheets.
      printTarget = 'sheets';
    };
    window.addEventListener('afterprint', restore);
    // Same safety net as the batch flow: afterprint is reliable but not
    // guaranteed, and a stuck printTarget would silently misdirect the NEXT
    // print job to the wrong subtree.
    manifestPrintTimer = setTimeout(restore, AFTER_PRINT_TIMEOUT_MS);

    window.print();
  }

  function teardownAfterPrint() {
    if (detachAfterPrint) {
      detachAfterPrint();
      detachAfterPrint = null;
    }
    clearTimeout(afterPrintTimer);
    afterPrintTimer = null;
  }

  /** Admin confirmed the sheets came out: record it and refresh the queue. */
  async function confirmPrinted() {
    if (printPhase !== 'confirm') return;
    printPhase = 'marking';
    error = '';

    const { data, error: rpcErr } = await supabase.rpc('admin_mark_orders_printed', {
      p_order_ids: printBatchIds
    });

    if (rpcErr) {
      error = 'שגיאה בסימון ההדפסה.';
      // Stay in 'confirm' so the admin can retry without reprinting.
      printPhase = 'confirm';
      return;
    }

    // The RPC only advances orders still sitting in `ready_for_print`, and it
    // reports how many it touched. Ignoring that count meant a batch where
    // another admin had meanwhile cancelled or advanced an order was reported
    // as fully successful — and the untouched order silently reappeared in the
    // queue after the refresh below, with no explanation.
    const updated = Number(data?.updated ?? 0);
    const expected = printBatchIds.length;
    const partialMsg =
      updated < expected
        ? `סומנו ${updated} מתוך ${expected} הזמנות. ` +
          'ייתכן שסטטוס של חלקן השתנה בינתיים — בדוק אותן בתור המרוענן.'
        : '';

    if (partialMsg) {
      // Recurrence here means two admins are working the queue concurrently.
      trackPrintEvent(PRINT_EVENTS.MARK_PARTIAL, { updated, expected });
    }

    invalidatePreview();
    batchPages = [];
    mosaicRefs = [];
    manifest = [];
    signedUrls = {};
    itemsByOrder = {};
    jobsByOrder = {};
    printBatchIds = [];
    printPhase = 'idle';
    // Nothing is selected until the refreshed queue produces a new suggestion;
    // leaving the old ids in `selected` let a later queue re-select orders the
    // admin never picked.
    selected = {};
    await loadQueue();
    // Set AFTER the reload, and on `notice` rather than `error`: both loadQueue
    // and the preview load that follows it clear `error`, so a warning about
    // what just happened to real orders would vanish within 300ms.
    notice = partialMsg;
  }

  /** Admin cancelled or the print failed: leave every order untouched. */
  function dismissPrintConfirm() {
    printBatchIds = [];
    printPhase = 'idle';
  }

  onDestroy(() => {
    // Previously the afterprint listener and the debounce timer both outlived
    // the component if the admin navigated away mid-flow.
    teardownAfterPrint();
    clearTimeout(previewDebounceTimer);
    clearTimeout(manifestPrintTimer);
    clearInterval(freshnessTimer);
    // Invalidate any in-flight preview continuation.
    previewRequestId++;
  });

  $: selectedCount = selectedOrders.length;
</script>

<svelte:window on:keydown={onWindowKeydown} />

<svelte:head>
  <title>FEEL Admin — הדפסה</title>
</svelte:head>

<div class="print-layout">
  <!-- Sidebar -->
  <aside class="print-sidebar">
    <h2 class="sidebar-title">תור הדפסה</h2>

    <div class="sidebar-actions">
      <button class="admin-btn admin-btn--mini" on:click={applySuggestion} disabled={queue.length === 0}>
        הצע מנה
      </button>
      <button class="admin-btn admin-btn--mini" on:click={selectAll} disabled={queue.length === 0}>
        בחר הכל
      </button>
      <button class="admin-btn admin-btn--mini" on:click={clearSelection} disabled={selectedCount === 0}>
        נקה
      </button>
    </div>

    {#if selectedCount > 0}
      <div class="sidebar-stats">
        <span>{selectedCount} הזמנות</span>
        <span title={tileCountIsEstimate ? 'הערכה לפי התור; יתעדכן למספר המדויק בסיום טעינת התצוגה' : 'מספר מדויק מתוך הגיליונות'}>
          {tileCountIsEstimate ? '~' : ''}{tileCount} מגנטים
        </span>
        <span>{tileCountIsEstimate ? '~' : ''}{pageCount} גיליונות</span>
        <span class="util-badge" class:util-high={utilization >= 90}>
          {utilization}% ניצולת
        </span>
        <!-- Concrete and actionable where a bare percentage is not: this is how
             many more magnets would ride along on paper already being used. -->
        {#if !tileCountIsEstimate && emptySlots > 0}
          <span class="slots-badge">{emptySlots} משבצות ריקות בגיליון האחרון</span>
        {/if}
      </div>
    {/if}

    {#if suggestionExceeds}
      <p class="sidebar-note">
        ההזמנה הוותיקה בתור לבדה חורגת מ-10 גיליונות. היא נבחרה לבדה — ודא שיש מספיק נייר.
      </p>
    {:else if suggestionSkippedIds.length > 0}
      <p class="sidebar-note">
        {suggestionSkippedIds.length} הזמנות לא נכללו בהצעה כי הן חורגות ממכסת הגיליונות. אפשר לסמן אותן ידנית.
      </p>
    {/if}

    {#if loading}
      <p class="hint">טוען…</p>
    {:else if queue.length === 0}
      <p class="hint">אין הזמנות ממתינות להדפסה.</p>
    {:else}
      <ul class="order-list">
        {#each queue as order}
          {@const actual = actualByOrder[order.id]}
          {@const mismatch = actual != null && actual !== order.visible_tile_count}
          {@const brokenCount = issuesByOrder.find((r) => r.orderId === order.id)?.count ?? 0}
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
                <!--
                  Estimate vs truth, per order. The header already distinguishes
                  the queue's estimate from the flattened count, but when the two
                  disagree only this line says WHICH order caused it.
                -->
                <span class="order-tiles" class:order-tiles--mismatch={mismatch}>
                  {#if actual == null}
                    {order.visible_tile_count} מגנטים
                  {:else if mismatch}
                    {actual} מגנטים (בתור: {order.visible_tile_count})
                  {:else}
                    {actual} מגנטים
                  {/if}
                </span>
                {#if brokenCount > 0}
                  <span class="order-broken">⚠ {brokenCount} ללא תמונה</span>
                {/if}
              </span>
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
        {#if loadingPreview && progressTotal > 0}
          👁️ תצוגה מקדימה ({progressDone}/{progressTotal})
        {:else}
          👁️ תצוגה מקדימה
        {/if}
      </button>
      <button
        class="admin-btn admin-btn--primary"
        on:click={sendToPrint}
        disabled={!canPrint}
        title={!imagesReady
          ? 'ממתין לסיום טעינת התצוגה המקדימה'
          : urlsStale
            ? 'קישורי התמונות פגו — יש לרענן את התצוגה'
            : printBlockedByIssues
              ? 'יש אריחים ללא תמונה — ההדפסה חסומה'
              : 'פתח את דיאלוג ההדפסה'}
      >
        {#if loadingPreview}
          <!-- A denominator, so a slow batch is distinguishable from a hang. -->
          {#if progressPhase === 'signing'}
            ⏳ חותם קישורים {progressDone}/{progressTotal}
          {:else if progressPhase === 'images'}
            ⏳ טוען תמונות {progressDone}/{progressTotal}
          {:else}
            ⏳ טוען תצוגה…
          {/if}
        {:else if printPhase === 'dialog'}
          🖨️ דיאלוג ההדפסה פתוח…
        {:else if printPhase === 'marking'}
          ⏳ מסמן כהודפס…
        {:else}
          🖨️ שלח להדפסה
        {/if}
      </button>
      <!--
        Separate job, separate paper. Optional: the work order is also on
        screen in the preview modal, so printing it is the operator's call.
      -->
      <button
        class="admin-btn"
        on:click={printManifestOnly}
        disabled={manifest.length === 0 || printing}
        title="מדפיס רק את דף העבודה — החלף לנייר רגיל לפני ההדפסה"
      >
        📋 הדפס דף עבודה
      </button>
      <button
        class="admin-btn"
        on:click={() => { invalidatePreview(); schedulePreviewLoad(); }}
        disabled={loadingPreview || printing || selectedCount === 0}
        title="חתום מחדש על התמונות וטען את התצוגה מחדש"
      >
        ↻ רענן תצוגה
      </button>
    </div>

    <!--
      Outcome of a completed print that must not be swallowed by the queue
      refresh and preview reload that immediately follow it.
    -->
    {#if notice}
      <div class="print-notice" role="status">
        <span>{notice}</span>
        <button class="notice-close" on:click={() => (notice = '')} aria-label="סגור הודעה">✕</button>
      </div>
    {/if}

    <!--
      BLOCKING integrity report. Original uploads are best-effort (see
      orderOriginals.js), signed URLs can fail, and images can fail to decode —
      each of which used to end as an anonymous grey square that the guillotine
      turned into a blank magnet. The batch cannot print until these are
      resolved or the admin explicitly accepts them.
    -->
    {#if tileIssues.length > 0}
      <div class="issue-panel" class:issue-panel--overridden={overrideIssues} role="alert">
        <strong class="issue-title">
          ⚠ {tileIssues.length} אריחים ללא תמונה תקינה — יודפסו ריקים
        </strong>
        <ul class="issue-list">
          {#each issuesByOrder as row}
            <li>
              <a class="issue-order-link" href="/admin/orders/{row.orderId}">#{row.orderNumber}</a>
              — {row.count} אריחים:
              <span class="issue-detail">{row.labels.join(' · ')}{row.count > row.labels.length ? ' …' : ''}</span>
            </li>
          {/each}
        </ul>
        <div class="issue-actions">
          <button
            class="admin-btn"
            on:click={() => { invalidatePreview(); schedulePreviewLoad(); }}
            disabled={loadingPreview}
          >
            ↻ נסה לטעון שוב
          </button>
          {#if !overrideIssues}
            <button class="admin-btn admin-btn--danger-ghost" on:click={acceptBrokenTiles}>
              הדפס בכל זאת (האריחים יצאו ריקים)
            </button>
          {:else}
            <span class="issue-override-note">
              ההדפסה שוחררה למרות האריחים החסרים.
              <button class="link-btn" on:click={() => (overrideIssues = false)}>בטל</button>
            </span>
          {/if}
        </div>
      </div>
    {/if}

    {#if urlsStale}
      <div class="issue-panel" role="alert">
        <strong class="issue-title">⚠ קישורי התמונות פגו</strong>
        <p class="issue-stale-text">
          התצוגה נחתמה לפני יותר מ-40 דקות. הדפסה עכשיו עלולה להוציא גיליון ריק — רענן לפני ההדפסה.
        </p>
        <div class="issue-actions">
          <button
            class="admin-btn"
            on:click={() => { invalidatePreview(); schedulePreviewLoad(); }}
            disabled={loadingPreview}
          >
            ↻ רענן תצוגה
          </button>
        </div>
      </div>
    {/if}

    <!--
      Post-dialog confirmation. `afterprint` fires identically whether the
      admin printed or cancelled, so the order status is only written after an
      explicit answer. Until then nothing is mutated.
    -->
    {#if printPhase === 'confirm' || printPhase === 'marking'}
      <div class="print-confirm" role="status">
        <div class="print-confirm-text">
          <strong>האם הגיליונות יצאו בהצלחה מהמדפסת?</strong>
          <span>
            {printBatchIds.length} הזמנות יסומנו כ"הודפס". אם ההדפסה בוטלה או נכשלה,
            בחר "לא" והסטטוס יישאר ללא שינוי.
          </span>
        </div>
        <div class="print-confirm-actions">
          <button
            class="admin-btn admin-btn--primary"
            on:click={confirmPrinted}
            disabled={printPhase === 'marking'}
          >
            {printPhase === 'marking' ? 'מסמן…' : 'כן, סמן כהודפס'}
          </button>
          <button
            class="admin-btn"
            on:click={dismissPrintConfirm}
            disabled={printPhase === 'marking'}
          >
            לא, בטל
          </button>
        </div>
      </div>
    {/if}

    {#if error}
      <p class="error-msg">{error}</p>
    {/if}

    <div class="print-hint">
      <!--
        The page REQUESTS A4 / no margins / no scaling via @page; it cannot
        enforce them. The browser's own Scale setting overrides everything here,
        and "Fit to page" silently shrinks a 50mm tile to ~48mm. Saying so is
        the difference between a warning the operator can act on and a promise
        the code cannot keep.
      -->
      ⚠️ ודא שב-Scale בדיאלוג ההדפסה מסומן <strong>100%</strong> ולא "Fit to page" —
      אחרת האריחים יצאו קטנים מ-50 מ"מ. גודל אריח: 50×50 מ"מ.
      {#if manifest.length > 0}
        <br />📋 דף העבודה מודפס בנפרד (כפתור משלו) — החלף לנייר רגיל, אין צורך בנייר מגנטי.
      {/if}
    </div>

    <!-- Print root — this is what gets printed -->
    <!--
      bind:this lets loadPreview() scan the mounted <img> tags and await their
      load events before flipping `imagesReady`. The `print-root--hidden` class
      is keyed on `imagesReady` (not `previewReady`) so the tree is mounted
      (images download) while remaining display:none until every tile is ready —
      preventing the "flash of wrong crop" the admin was seeing.
    -->
    <div
      class="print-root"
      class:print-root--hidden={!imagesReady}
      class:print-root--sheets={printTarget === 'sheets'}
      class:print-root--manifest={printTarget === 'manifest'}
      bind:this={printRootEl}
    >
      {#if previewReady}
        {#each batchPages as page}
          <!--
            Two elements on purpose: transform:scale() paints smaller but does
            NOT shrink the element's layout box, so a single scaled 297mm sheet
            still reserved 297mm of column height and left a large dead gap
            after every page. The outer box is sized to the SCALED dimensions;
            the inner one keeps true A4 geometry for the print engine.
          -->
          <div class="page-preview-wrapper">
            <div class="page-preview-inner">
              <PrintBatchPage pageData={page} {signedUrls} />
            </div>
          </div>
        {/each}

        <!--
          Work order, printed after the sheets. It flows over as many pages as
          the greetings need rather than being pinned to a fixed A4 box, so a
          long greeting cannot be clipped. `page-break-before` on the wrapper
          keeps it off the last cutting sheet; the trailing-blank-page trap the
          sheets hit does not apply because nothing follows it.
        -->
        {#if manifest.length > 0}
          <div class="manifest-wrapper">
            <PrintManifest {manifest} {tileCount} {pageCount} />
          </div>
        {/if}
      {/if}
    </div>
  </main>
</div>

<!-- Preview Modal -->
{#if previewModalOpen}
  <!--
    The backdrop is a click-to-dismiss convenience only; Escape (see
    onWindowKeydown) and the close button are the accessible paths, so the
    backdrop itself is inert to the accessibility tree rather than being a
    fake button. Previously the a11y warnings here were suppressed with
    svelte-ignore without providing any keyboard route out of the modal.
  -->
  <div
    class="preview-modal-backdrop"
    on:click={closePreviewModal}
    aria-hidden="true"
  ></div>
  <div class="preview-modal-layer" role="presentation">
    <div
      class="preview-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
      tabindex="-1"
      bind:this={previewModalEl}
    >
      <div class="preview-modal-header">
        <span class="preview-modal-title" id="preview-modal-title">תצוגה מקדימה — {pageCount} עמודים, {tileCount} מגנטים</span>
        <button class="preview-modal-close" on:click={closePreviewModal}>✕ סגור</button>
      </div>
      <div class="preview-modal-body">
        {#if tileIssues.length > 0}
          <div class="modal-issue-banner" role="alert">
            ⚠ {tileIssues.length} אריחים במנה זו יודפסו ריקים — ראה את הריבועים המסומנים בגיליונות.
          </div>
        {/if}

        {#if manifest.length > 0}
          <!-- Same work order that goes on paper, so the admin reviews the
               greetings and notes before committing rather than after. -->
          <section class="modal-manifest">
            <PrintManifest {manifest} {tileCount} {pageCount} />
          </section>
        {/if}

        {#if mosaicRefs.length > 0}
          <!--
            Verification aid, NOT a print artefact. The sheets below nest tiles
            3-across for paper efficiency, so a 4/5-column mosaic is unreadable
            as a picture on paper. These show each mosaic assembled at its
            native grid — same crop/zoom/effect the customer applied — so the
            admin can confirm the source image before printing.
          -->
          <section class="mosaic-ref-section">
            <h3 class="mosaic-ref-section-title">
              פסיפסים בהזמנה — כפי שהלקוח הרכיב
            </h3>
            <p class="mosaic-ref-section-hint">
              הגיליונות למטה הם גיליונות חיתוך: האריחים מסודרים 3 בשורה לחיסכון בנייר,
              ולכן אינם נראים כמו התמונה. כל אריח מסומן בתווית (עמודה/שורה) להרכבה.
            </p>
            <div class="mosaic-ref-list">
              {#each mosaicRefs as ref (ref.key)}
                <MosaicReference {ref} url={signedUrls[ref.storagePath] || ''} />
              {/each}
            </div>
          </section>
        {/if}

        {#each batchPages as page, i}
          {@const pageOrders = ordersOnPage(page)}
          <div class="preview-modal-page">
            <!--
              The packer nests tiles from several orders onto one sheet for
              paper efficiency, so "עמוד 2/3" alone told the operator nothing
              about what they were about to cut. Naming the orders makes the
              sheet self-describing before it is sorted.
            -->
            <div class="preview-modal-page-label">
              גיליון {i + 1} / {pageCount}
              <span class="page-orders">— הזמנות {pageOrders.map((n) => `#${n}`).join(', ')}</span>
            </div>
            <div class="preview-modal-page-inner">
              <div class="preview-modal-page-sheet">
                <PrintBatchPage pageData={page} {signedUrls} />
              </div>
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

  .sidebar-actions {
    display: flex;
    gap: 6px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }

  .slots-badge {
    background: #e3f2fd;
    color: #1565c0;
    border-radius: 4px;
    padding: 1px 6px;
    font-weight: 600;
  }

  .sidebar-note {
    font-size: 12px;
    line-height: 1.5;
    color: #8a6d3b;
    background: #fff8e1;
    border: 1px solid #ffe082;
    border-radius: 6px;
    padding: 6px 8px;
    margin: 0 0 12px;
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

  /* Law B: the queue rows are the primary control on this screen and were well
     under the 44px touch minimum. */
  .order-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 13px;
    min-height: 44px;
    padding: 2px 0;
  }

  .order-label input[type='checkbox'] {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    accent-color: #1976d2;
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

  .order-tiles--mismatch {
    color: #b26a00;
    font-weight: 700;
  }

  .order-broken {
    font-size: 11px;
    font-weight: 700;
    color: #c62828;
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

  /* --preview-scale was previously referenced but never assigned anywhere, so
     the fallback was the only value that ever applied. It is now a real knob,
     set per breakpoint below. */
  .page-preview-wrapper {
    --preview-scale: 0.67;
    width: calc(210mm * var(--preview-scale));
    height: calc(297mm * var(--preview-scale));
    margin-bottom: 24px;
    /* Law C: every tile holds a FULL-RESOLUTION original — these are the
       customer's camera files, not thumbnails. Skipping layout/paint for
       off-screen sheets keeps a 10-page batch scrollable. The box is already
       a fixed size, so `contain-intrinsic-size` is unnecessary and there is no
       scroll-anchoring jump. Print re-enables it below. */
    content-visibility: auto;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
    /* The sheet is an LTR artefact inside an RTL shell; pinning the direction
       keeps transform-origin:top left meaningful. */
    direction: ltr;
  }

  .page-preview-inner {
    width: 210mm;
    height: 297mm;
    transform-origin: top left;
    transform: scale(var(--preview-scale));
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

  .admin-btn--mini { padding: 5px 10px; font-size: 12px; }

  .admin-btn--danger-ghost {
    border-color: #e53935;
    color: #c62828;
  }
  .admin-btn--danger-ghost:hover:not(:disabled) { background: #ffeaea; }

  /* ── Notice / integrity panels ──────────────────────────────────────────── */
  .print-notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: #e3f2fd;
    border: 1px solid #90caf9;
    color: #0d47a1;
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 13px;
    margin-bottom: 12px;
  }

  .notice-close {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 14px;
    color: #0d47a1;
    padding: 4px 6px;
    flex-shrink: 0;
  }

  .issue-panel {
    background: #ffeaea;
    border: 1px solid #ef9a9a;
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 14px;
  }

  /* Overridden: still visible, but no longer the loudest thing on screen. */
  .issue-panel--overridden {
    background: #fff8e1;
    border-color: #ffe082;
  }

  .issue-title {
    display: block;
    font-size: 14px;
    color: #b71c1c;
    margin-bottom: 6px;
  }

  .issue-panel--overridden .issue-title { color: #8a6d3b; }

  .issue-list {
    margin: 0 0 10px;
    padding-inline-start: 18px;
    font-size: 12.5px;
    line-height: 1.6;
    color: #5d4037;
  }

  .issue-order-link {
    font-weight: 700;
    color: #1976d2;
  }

  .issue-detail { color: #777; }

  .issue-stale-text {
    margin: 0 0 10px;
    font-size: 13px;
    line-height: 1.5;
    color: #5d4037;
  }

  .issue-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .issue-override-note {
    font-size: 12.5px;
    color: #8a6d3b;
  }

  .link-btn {
    border: none;
    background: none;
    color: #1976d2;
    cursor: pointer;
    font-size: 12.5px;
    text-decoration: underline;
    padding: 0 2px;
  }

  .modal-issue-banner {
    width: 100%;
    box-sizing: border-box;
    background: #ffeaea;
    border: 1px solid #ef9a9a;
    color: #b71c1c;
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 600;
  }

  /* ── Work order (manifest) ──────────────────────────────────────────────── */
  .manifest-wrapper {
    /* No page-break-before here on purpose. The work order and the cutting
       sheets are never emitted in the same print job any more, so forcing a
       break would only risk a LEADING blank page when the manifest prints
       alone as the first visible element. */
    /* On screen it is a plain card in the flow; the sheets above are scaled A4
       mocks, but the work order has no fixed page geometry to preview. */
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
    max-width: 210mm;
  }

  .modal-manifest {
    width: 100%;
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    overflow: hidden;
    box-sizing: border-box;
  }

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
    .print-notice,
    .issue-panel,
    .print-hint {
      display: none !important;
    }

    /* The work order is content, not chrome: strip only its screen framing. */
    .manifest-wrapper {
      border: none;
      border-radius: 0;
      box-shadow: none;
      max-width: none;
    }

    /* One print job = one paper tray. The cutting sheets go on magnetic stock
       and the work order on plain paper, so exactly one of the two is emitted
       per job — never both. `printTarget` picks which. */
    .print-root--sheets .manifest-wrapper {
      display: none !important;
    }
    .print-root--manifest .page-preview-wrapper {
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

    .page-preview-wrapper,
    .page-preview-inner {
      transform: none !important;
      /* MUST be neutralised for print: a sheet whose rendering the browser
         skipped because it was off-screen must still reach the paper. */
      content-visibility: visible !important;
      width: auto;
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

  /* ── Responsive ─────────────────────────────────────────────────────────────
     The admin previously had no breakpoints whatsoever: .print-layout is a
     flex row with a hard 320px sidebar next to a 210mm-wide sheet preview, so
     anything under ~1100px scrolled horizontally. CLAUDE.md Law B forbids
     horizontal scrolling anywhere, admin included. */
  @media (max-width: 1100px) {
    .page-preview-wrapper { --preview-scale: 0.52; }
  }

  @media (max-width: 900px) {
    .print-layout {
      flex-direction: column;
      gap: 16px;
      min-height: 0;
    }

    .print-sidebar {
      width: auto;
      max-height: 320px;
      position: static;
      border-left: none;
      border-bottom: 1px solid #e0e0e0;
      padding-left: 0;
      padding-bottom: 12px;
    }

    .page-preview-wrapper { --preview-scale: 0.62; }
  }

  @media (max-width: 640px) {
    .toolbar .admin-btn {
      flex: 1 1 auto;
    }

    .print-confirm {
      flex-direction: column;
      align-items: stretch;
    }

    .page-preview-wrapper { --preview-scale: 0.42; }
  }

  /* ── Print confirmation panel ───────────────────────────────────────────── */
  .print-confirm {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    background: #fff8e1;
    border: 1px solid #ffe082;
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 16px;
  }

  .print-confirm-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: #5d4037;
    min-width: 0;
  }

  .print-confirm-text strong {
    font-size: 14px;
    color: #3e2723;
  }

  .print-confirm-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  @media print {
    .print-confirm { display: none !important; }
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
  }

  /* Scroll container for the dialog. Split out from the backdrop so the
     backdrop can be aria-hidden and click-to-dismiss without the dialog being
     its descendant (a dialog inside an aria-hidden subtree is hidden from
     assistive tech). */
  .preview-modal-layer {
    position: fixed;
    inset: 0;
    z-index: 1001;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    overflow-y: auto;
    padding: 24px 16px;
    pointer-events: none;
  }
  .preview-modal-layer > * {
    pointer-events: auto;
  }

  .preview-modal:focus {
    outline: none;
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

  /* ── Assembled-mosaic reference (screen-only verification aid) ──────────── */
  .mosaic-ref-section {
    width: 100%;
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 16px 18px;
    box-sizing: border-box;
  }

  .mosaic-ref-section-title {
    margin: 0 0 4px;
    font-size: 14px;
    font-weight: 700;
    color: #1e1e1e;
  }

  .mosaic-ref-section-hint {
    margin: 0 0 14px;
    font-size: 12px;
    line-height: 1.5;
    color: #666;
  }

  .mosaic-ref-list {
    display: grid;
    /* auto-fit keeps one mosaic per row on narrow modals and two side-by-side
       when there is room — no horizontal scrolling either way. */
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 18px;
    align-items: start;
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
    text-align: center;
  }

  .page-orders {
    color: #444;
    font-weight: 600;
  }

  /* Scale A4 down to the modal width. Same wrapper/inner split as the inline
     preview: the outer box carries the SCALED size so the flex column spaces
     pages correctly, replacing the previous negative-margin compensation.
     --modal-page-scale is now actually assigned rather than always falling
     back to its default. */
  .preview-modal-page-inner {
    --modal-page-scale: 0.72;
    width: calc(210mm * var(--modal-page-scale));
    height: calc(297mm * var(--modal-page-scale));
    /* Same reasoning as .page-preview-wrapper: while the modal is open these
       are a SECOND full set of originals, so skipping the off-screen ones
       matters more here, not less. */
    content-visibility: auto;
    box-shadow: 0 2px 16px rgba(0,0,0,0.15);
    border: 1px solid #e0e0e0;
    border-radius: 2px;
    overflow: hidden;
    background: white;
    direction: ltr;
  }

  .preview-modal-page-sheet {
    width: 210mm;
    height: 297mm;
    transform-origin: top left;
    transform: scale(var(--modal-page-scale));
  }

  @media (max-width: 820px) {
    .preview-modal-page-inner { --modal-page-scale: 0.55; }
  }
  @media (max-width: 560px) {
    .preview-modal-page-inner { --modal-page-scale: 0.38; }
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
