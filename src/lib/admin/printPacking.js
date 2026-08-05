// Admin print packing algorithm — pure functions, no DOM dependency.
// Lays out visible magnets/tiles from multiple orders onto A4 pages.

// ── Sheet geometry (mm) ───────────────────────────────────────────────────────
// Internal: these only exist to DERIVE the two numbers the app consumes, so the
// page capacity is computed from the physical constraints rather than being a
// magic 15. A previous set of exported constants here (TILE_MM, PAGE_W_MM,
// COLS, ROW_H_MM, ...) had no remaining consumers after PrintPage.svelte was
// removed and has been dropped.
const TILE_MM = 50;          // physical magnet edge, fixed by the product
const GAP_MM = 5;            // guillotine bleed between tiles
const PAGE_MARGIN_MM = 10;   // conservative bound; the sheet itself uses 8/5mm

const USABLE_W_MM = 210 - PAGE_MARGIN_MM * 2; // 190
const USABLE_H_MM = 297 - PAGE_MARGIN_MM * 2; // 277
const PITCH_MM = TILE_MM + GAP_MM;            // 55

/**
 * Columns of 50mm tiles that fit across A4 portrait: floor(195 / 55) = 3.
 *
 * NOTE: PrintBatchPage.svelte hardcodes `repeat(3, 50mm) !important` in its
 * stylesheet (the !important is a deliberate guard against print-time cascade
 * resets). If this value ever changes, that rule must change with it.
 */
export const BATCH_COLS = Math.floor((USABLE_W_MM + GAP_MM) / PITCH_MM); // 3

/** Rows that fit down the sheet: floor(282 / 55) = 5. */
const BATCH_ROWS = Math.floor((USABLE_H_MM + GAP_MM) / PITCH_MM); // 5

/** Tiles per A4-portrait sheet: 3 cols x 5 rows = 15. */
export const ITEMS_PER_PAGE = BATCH_COLS * BATCH_ROWS;

// ── Suggestion engine ─────────────────────────────────────────────────────────

/**
 * Suggest a batch of orders from the queue that fills pages efficiently.
 * Greedy from the oldest order forward, stopping once the utilization target
 * is met.
 *
 * An order that would push the batch past `maxPages` is SKIPPED rather than
 * ending the scan: the previous `break` meant one oversized order hid every
 * smaller order behind it in the queue. Skipped ids are reported so the UI can
 * name them instead of silently omitting them.
 *
 * @param {Array<{id: string, visible_tile_count: number, [key: string]: any}>} queue
 * @param {number} maxPages
 * @param {number} utilizationTarget
 * @returns {{selectedIds: string[], utilization: number, skippedIds: string[], exceedsMaxPages: boolean}}
 */
export function suggestOptimalBatch(queue, maxPages = 10, utilizationTarget = 0.9) {
  if (!queue || queue.length === 0) {
    return { selectedIds: [], utilization: 0, skippedIds: [], exceedsMaxPages: false };
  }

  const selected = [];
  const skippedIds = [];
  let bestIds = [];
  let bestUtil = 0;

  for (const order of queue) {
    selected.push(order);
    const totalTiles = selected.reduce((s, o) => s + (o.visible_tile_count || 0), 0);
    const pages = Math.ceil(totalTiles / ITEMS_PER_PAGE);

    if (pages > maxPages) {
      selected.pop();
      skippedIds.push(order.id);
      continue;
    }

    const util = pages > 0 ? totalTiles / (pages * ITEMS_PER_PAGE) : 0;
    bestIds = selected.map((o) => o.id);
    bestUtil = util;

    if (util >= utilizationTarget) break;
  }

  // Nothing fit at all — i.e. the oldest order alone exceeds the page budget.
  // Returning an empty selection here deadlocked the queue: the admin saw
  // pending orders with zero selected and no explanation. Offer the oldest
  // order on its own and flag that it overflows, so the UI can say so.
  if (bestIds.length === 0) {
    const first = queue[0];
    if (!first) return { selectedIds: [], utilization: 0, skippedIds: [], exceedsMaxPages: false };
    const tiles = first.visible_tile_count || 0;
    const pages = Math.ceil(tiles / ITEMS_PER_PAGE);
    return {
      selectedIds: [first.id],
      utilization: pages > 0 ? tiles / (pages * ITEMS_PER_PAGE) : 0,
      skippedIds: skippedIds.filter((id) => id !== first.id),
      exceedsMaxPages: true
    };
  }

  return {
    selectedIds: bestIds,
    utilization: bestUtil,
    skippedIds: skippedIds.filter((id) => !bestIds.includes(id)),
    exceedsMaxPages: false
  };
}

// ── Mosaic helpers ────────────────────────────────────────────────────────────

/**
 * Compute the mosaic grid dimensions (cols × rows) the editor renders.
 *
 * @param {number} base  — gridBaseSize as stored in settingsMeta
 * @param {number | null | undefined} imageRatio  — naturalW / naturalH (if known)
 * @param {number | null | undefined} count  — total visible tiles (fallback)
 * @returns {{ cols: number, rows: number }}
 */
export function computeMosaicGridDims(base, imageRatio, count) {
  const safeBase = Math.max(1, Math.round(Number(base) || 3));

  if (typeof imageRatio === 'number' && Number.isFinite(imageRatio) && imageRatio > 0) {
    if (imageRatio > 1) {
      return { cols: Math.max(1, Math.round(safeBase * imageRatio)), rows: safeBase };
    }
    return { cols: safeBase, rows: Math.max(1, Math.round(safeBase / imageRatio)) };
  }

  // Fallback: try to recover from `count` (cols × rows must equal count).
  if (typeof count === 'number' && count > 0) {
    if (count % safeBase === 0) {
      const cols = count / safeBase;
      if (cols >= safeBase) return { cols, rows: safeBase };
      return { cols: safeBase, rows: cols };
    }
  }

  return { cols: safeBase, rows: safeBase };
}

/**
 * Expand a mosaic item into individual tile descriptors.
 * Law A invariant: this metadata MUST reproduce the exact frame from the editor.
 *
 * @param {{
 *   configuration?: {
 *     count?: number;
 *     settingsMeta?: {
 *       gridBaseSize?: number;
 *       splitImageRatio?: number | null;
 *       splitTransform?: { zoom?: number; xPct?: number; yPct?: number } | null;
 *       currentEffect?: string | null;
 *     };
 *   };
 *   original_storage_paths?: { source?: string };
 * }} item
 * @returns {Array<{
 *   storagePath: string;
 *   cropRect: { col: number; row: number; cols: number; rows: number };
 *   transform: { zoom: number; xPct: number; yPct: number };
 *   effect: string;
 *   imageRatio: number | null;
 * }>}
 */
export function expandMosaicToTiles(item) {
  const meta = item.configuration?.settingsMeta || {};
  const base = meta.gridBaseSize || 3;
  const imageRatio =
    typeof meta.splitImageRatio === 'number' && meta.splitImageRatio > 0
      ? meta.splitImageRatio
      : null;
  const count =
    typeof item.configuration?.count === 'number' && item.configuration.count > 0
      ? item.configuration.count
      : null;

  const { cols, rows } = computeMosaicGridDims(base, imageRatio, count);

  const st = meta.splitTransform || {};
  const transform = {
    zoom: typeof st.zoom === 'number' && st.zoom > 0 ? st.zoom : 1,
    xPct: typeof st.xPct === 'number' ? st.xPct : 0,
    yPct: typeof st.yPct === 'number' ? st.yPct : 0
  };
  const effect = typeof meta.currentEffect === 'string' ? meta.currentEffect : 'original';

  const storagePath = item.original_storage_paths?.source || '';
  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push({
        storagePath,
        cropRect: { col, row, cols, rows },
        transform,
        effect,
        imageRatio
      });
    }
  }
  return tiles;
}

// ── Magnet helpers ────────────────────────────────────────────────────────────

/**
 * Extract visible magnet tiles from a magnets_pack item, in client display order.
 *
 * @param {{configuration: {magnetsMeta?: any[]}, original_storage_paths?: Record<string, string>}} item
 * @returns {Array<{storagePath: string, meta: {xPct: number, yPct: number, zoom: number, activeEffectId?: string}}>}
 */
export function expandMagnetsTiles(item) {
  const rawMeta = item.configuration?.magnetsMeta || [];
  const paths = item.original_storage_paths || {};

  // Preserve client display order: sort by explicit `order` field if present.
  const meta = rawMeta.some(m => typeof m.order === 'number')
    ? [...rawMeta].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : rawMeta;

  const tiles = [];
  for (const m of meta) {
    if (m.hidden) continue;
    tiles.push({
      storagePath: paths[m.id] || '',
      meta: {
        xPct: m.xPct ?? 0,
        yPct: m.yPct ?? 0,
        zoom: m.zoom ?? 1,
        activeEffectId: m.activeEffectId || 'original'
      }
    });
  }
  return tiles;
}

// ── Gift helper ───────────────────────────────────────────────────────────────

/**
 * Build a single tile descriptor for a gift item.
 * Uses the admin-overridden image/crop from the production job if available,
 * falling back to the original gift image from the order item.
 *
 * @param {{
 *   configuration?: { giftImage_path?: string };
 *   original_storage_paths?: { gift?: string };
 *   order_id: string;
 * }} item
 * @param {{
 *   gift_image_path?: string | null;
 *   overridden_gift_crop?: { zoom?: number; xPct?: number; yPct?: number; effect?: string } | null;
 * } | null} jobData  — per-order production job overrides from admin_get_print_originals
 * @returns {{ storagePath: string, meta: { xPct: number, yPct: number, zoom: number, activeEffectId: string }, isGift: true }}
 *          Always a descriptor — `storagePath` may be '' (see below).
 */
export function expandGiftTile(item, jobData) {
  // Prefer admin-overridden image; fall back to original gift image in storage.
  const storagePath =
    jobData?.gift_image_path ||
    item.original_storage_paths?.gift ||
    item.configuration?.giftImage_path ||
    '';

  // A gift item with no resolvable image used to return null and vanish from
  // the batch. The customer paid for that magnet and the print queue counts it
  // (admin_get_print_queue: item_type='gift' -> 1), so dropping it produced a
  // silent short-ship AND an unexplained gap between the estimate and the real
  // tile count. Emit the tile with an empty path instead: collectTileIssues
  // then reports it and the print is blocked until it is resolved.
  const crop = jobData?.overridden_gift_crop || {};
  return {
    storagePath,
    meta: {
      xPct: typeof crop.xPct === 'number' ? crop.xPct : 0,
      yPct: typeof crop.yPct === 'number' ? crop.yPct : 0,
      zoom: typeof crop.zoom === 'number' && crop.zoom > 0 ? crop.zoom : 1,
      activeEffectId: typeof crop.effect === 'string' ? crop.effect : 'original'
    },
    isGift: true
  };
}

// ── Flat-batch pipeline ───────────────────────────────────────────────────────

/**
 * Flatten every visible tile across the supplied orders into one array.
 * Each entry carries enough metadata for PrintBatchPage to render it at
 * pixel-perfect 50mm × 50mm with the correct crop / effect, plus the
 * `orderNumber` used for the cut-label.
 *
 * @param {Array<{id: string, order_number: number|string}>} orders
 * @param {Record<string, Array<any>>} itemsByOrder
 * @param {Record<string, any>} [jobsByOrder]  — map of order_id → production job row
 * @returns {Array<{
 *   kind: 'magnet' | 'mosaic',
 *   orderId: string,
 *   orderNumber: number | string,
 *   storagePath: string,
 *   isGift?: boolean,
 *   meta?: { xPct: number, yPct: number, zoom: number, activeEffectId: string },
 *   cropRect?: { col: number, row: number, cols: number, rows: number },
 *   transform?: { zoom: number, xPct: number, yPct: number },
 *   effect?: string,
 *   imageRatio?: number | null
 * }>}
 */
export function flattenTilesForBatch(orders, itemsByOrder, jobsByOrder = {}) {
  const out = [];
  if (!Array.isArray(orders)) return out;
  for (const order of orders) {
    const items = itemsByOrder?.[order.id] || [];
    const jobData = jobsByOrder?.[order.id] || null;
    for (const item of items) {
      if (item.item_type === 'mosaic') {
        const mosaicTiles = expandMosaicToTiles(item);
        for (const t of mosaicTiles) {
          out.push({
            kind: 'mosaic',
            orderId: order.id,
            orderNumber: order.order_number,
            storagePath: t.storagePath,
            cropRect: t.cropRect,
            transform: t.transform,
            effect: t.effect,
            imageRatio: t.imageRatio
          });
        }
      } else if (item.item_type === 'gift') {
        const giftTile = expandGiftTile(item, jobData);
        out.push({
          kind: 'magnet',
          orderId: order.id,
          orderNumber: order.order_number,
          storagePath: giftTile.storagePath,
          meta: giftTile.meta,
          isGift: true
        });
      } else {
        const magnetTiles = expandMagnetsTiles(item);
        for (const t of magnetTiles) {
          out.push({
            kind: 'magnet',
            orderId: order.id,
            orderNumber: order.order_number,
            storagePath: t.storagePath,
            meta: t.meta
          });
        }
      }
    }
  }
  return out;
}

/**
 * Collect one "assembled reference" descriptor per mosaic in the batch.
 *
 * The printed sheet is a CUTTING sheet: tiles are nested 3-across for paper
 * efficiency, so a 4- or 5-column mosaic never visually reconstructs the
 * customer's photo on paper. That makes the print preview impossible to
 * eyeball-verify ("is this really their image?").
 *
 * These descriptors let the preview modal render each mosaic whole, at its
 * native cols × rows, using the same crop/zoom/effect the customer applied —
 * an on-screen reference the admin can compare against the sheet. Screen only;
 * never printed.
 *
 * @param {Array<{id: string, order_number: number|string}>} orders
 * @param {Record<string, Array<any>>} itemsByOrder
 * @returns {Array<{
 *   key: string,
 *   orderNumber: number | string,
 *   storagePath: string,
 *   cols: number,
 *   rows: number,
 *   transform: { zoom: number, xPct: number, yPct: number },
 *   effect: string,
 *   imageRatio: number | null
 * }>}
 */
export function collectMosaicRefs(orders, itemsByOrder) {
  const out = [];
  if (!Array.isArray(orders)) return out;
  for (const order of orders) {
    const items = itemsByOrder?.[order.id] || [];
    for (const item of items) {
      if (item.item_type !== 'mosaic') continue;
      const tiles = expandMosaicToTiles(item);
      const first = tiles[0];
      if (!first) continue;
      out.push({
        key: `${order.id}:${item.id ?? out.length}`,
        orderNumber: order.order_number,
        storagePath: first.storagePath,
        cols: first.cropRect.cols,
        rows: first.cropRect.rows,
        transform: first.transform,
        effect: first.effect,
        imageRatio: first.imageRatio
      });
    }
  }
  return out;
}

// ── Integrity ─────────────────────────────────────────────────────────────────

/**
 * Human-readable reason codes for a tile that cannot be printed.
 * `no_path`     — the order item never stored an original for this tile.
 *                 Original uploads are best-effort (see orderOriginals.js:
 *                 failures are logged and swallowed), so this genuinely happens.
 * `no_url`      — a path exists but createSignedUrl did not return a URL
 *                 (object missing from the bucket, or the sign call failed).
 * `load_failed` — the browser could not decode the image even after a retry.
 */
export const TILE_ISSUE_REASONS = {
  no_path: 'לא נשמרה תמונת מקור',
  no_url: 'התמונה לא נמצאה באחסון',
  load_failed: 'טעינת התמונה נכשלה'
};

/**
 * Find every tile that would print as a blank grey square.
 *
 * WHY THIS EXISTS
 * PrintBatchPage falls back to `.tile-placeholder` whenever it has no URL, and
 * `waitForAllImagesToSettle` only awaits <img> elements that actually mounted —
 * so a tile with no image produced NO image element, never blocked the ready
 * flag, and went to paper as a blank magnet that was then cut and shipped. The
 * defect was invisible until a customer opened the box. This makes it a
 * first-class, blocking condition.
 *
 * @param {Array<{orderId?: string, orderNumber?: number|string, storagePath?: string, isGift?: boolean, cropRect?: {col:number,row:number,cols:number,rows:number}}>} tiles
 * @param {Record<string, string>} [signedUrls]
 * @param {Set<string> | null} [failedPaths]  — storage paths whose <img> errored
 * @returns {Array<{orderId: string|undefined, orderNumber: number|string|undefined,
 *                  index: number, reason: keyof typeof TILE_ISSUE_REASONS,
 *                  label: string}>}
 */
export function collectTileIssues(tiles, signedUrls = {}, failedPaths = null) {
  const issues = [];
  if (!Array.isArray(tiles)) return issues;

  tiles.forEach((tile, index) => {
    const path = tile.storagePath || '';
    /** @type {keyof typeof TILE_ISSUE_REASONS | null} */
    let reason = null;

    if (!path) reason = 'no_path';
    else if (!signedUrls[path]) reason = 'no_url';
    else if (failedPaths?.has(path)) reason = 'load_failed';

    if (!reason) return;

    // Name the tile the way the operator sees it on the sheet: gift magnets and
    // mosaic cells carry distinct cut-labels.
    let label;
    if (tile.isGift) label = 'מגנט מתנה';
    else if (tile.cropRect) {
      label = `אריח פסיפס ${tile.cropRect.col + 1}/${tile.cropRect.cols},${tile.cropRect.row + 1}/${tile.cropRect.rows}`;
    } else label = `מגנט #${index + 1}`;

    issues.push({ orderId: tile.orderId, orderNumber: tile.orderNumber, index, reason, label });
  });

  return issues;
}

/**
 * Group issues by order for display: one row per affected order rather than one
 * row per tile, which for a broken mosaic would be dozens of identical lines.
 *
 * @param {ReturnType<typeof collectTileIssues>} issues
 * @returns {Array<{orderId: string|undefined, orderNumber: number|string|undefined,
 *                  count: number, labels: string[]}>}
 */
export function groupIssuesByOrder(issues) {
  /** @type {Map<string, {orderId: any, orderNumber: any, count: number, labels: string[]}>} */
  const byOrder = new Map();
  for (const issue of issues || []) {
    const key = String(issue.orderId ?? issue.orderNumber ?? '?');
    let row = byOrder.get(key);
    if (!row) {
      row = { orderId: issue.orderId, orderNumber: issue.orderNumber, count: 0, labels: [] };
      byOrder.set(key, row);
    }
    row.count += 1;
    // Cap the detail list: a fully-broken mosaic must not produce a 25-line banner.
    if (row.labels.length < 4) {
      row.labels.push(`${issue.label} — ${TILE_ISSUE_REASONS[issue.reason]}`);
    }
  }
  return [...byOrder.values()];
}

/**
 * Real tile count per order, derived from the flattened stream rather than the
 * queue's `visible_tile_count` estimate. The sidebar compares the two so a
 * discrepancy points at the specific order that caused it instead of only
 * showing up as a changed total in the header.
 *
 * @param {Array<{orderId?: string}>} tiles
 * @returns {Record<string, number>}
 */
export function countTilesByOrder(tiles) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const tile of tiles || []) {
    const key = tile.orderId;
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/**
 * Distinct order numbers appearing on one sheet, in the order they are laid
 * out. The flat packer nests tiles from several orders onto the same sheet, so
 * without this the operator cannot tell which orders a given page feeds.
 *
 * @param {{tiles: Array<{orderNumber?: number|string}>}} page
 * @returns {Array<number|string>}
 */
export function ordersOnPage(page) {
  const seen = [];
  for (const tile of page?.tiles || []) {
    if (tile.orderNumber == null) continue;
    if (!seen.includes(tile.orderNumber)) seen.push(tile.orderNumber);
  }
  return seen;
}

// ── Batch manifest (work order) ───────────────────────────────────────────────

/**
 * Build one manifest row per order in the batch.
 *
 * WHY THIS EXISTS
 * The cutting sheets carry nothing but tiles and a 6pt cut-label. Everything
 * the operator needs to actually FULFIL the order — who it belongs to, how many
 * magnets it should end up with, the greeting text that has to be printed and
 * inserted, the admin notes — existed only on the order detail screen, one
 * order at a time. `admin_get_print_originals` was already returning
 * `gift_message` and nobody read it. This assembles the work order that goes
 * out with the sheets.
 *
 * @param {Array<{id: string, order_number: number|string, shipping_first_name?: string, shipping_last_name?: string}>} orders
 * @param {Record<string, Array<any>>} itemsByOrder
 * @param {Record<string, any>} [jobsByOrder]
 * @param {Record<string, number>} [tileCounts]  — from countTilesByOrder
 * @returns {Array<{
 *   orderId: string, orderNumber: number|string, customerName: string,
 *   tileCount: number, hasGift: boolean, giftMessage: string,
 *   adminNotes: string, breakdown: Array<{type: string, count: number}>
 * }>}
 */
export function buildBatchManifest(orders, itemsByOrder, jobsByOrder = {}, tileCounts = {}) {
  const out = [];
  if (!Array.isArray(orders)) return out;

  for (const order of orders) {
    const items = itemsByOrder?.[order.id] || [];
    const job = jobsByOrder?.[order.id] || {};

    /** @type {Record<string, number>} */
    const perType = {};
    for (const item of items) {
      const type = item.item_type || 'magnets_pack';
      let count;
      if (type === 'mosaic') count = expandMosaicToTiles(item).length;
      else if (type === 'gift') count = 1;
      else count = expandMagnetsTiles(item).length;
      perType[type] = (perType[type] || 0) + count;
    }

    out.push({
      orderId: order.id,
      orderNumber: order.order_number,
      customerName: [order.shipping_first_name, order.shipping_last_name]
        .filter(Boolean)
        .join(' ')
        .trim(),
      tileCount: tileCounts[order.id] ?? Object.values(perType).reduce((s, n) => s + n, 0),
      hasGift: (perType.gift || 0) > 0,
      // Already coalesced server-side to the admin's override when one exists.
      giftMessage: typeof job.gift_message === 'string' ? job.gift_message : '',
      adminNotes: typeof job.admin_notes === 'string' ? job.admin_notes : '',
      breakdown: Object.entries(perType).map(([type, count]) => ({ type, count }))
    });
  }

  return out;
}

/**
 * Chunk a flat tile array into pages of `perPage` tiles each.
 *
 * @template T
 * @param {T[]} tiles
 * @param {number} [perPage]
 * @returns {Array<{ tiles: T[] }>}
 */
export function chunkTilesIntoPages(tiles, perPage = ITEMS_PER_PAGE) {
  if (!Array.isArray(tiles) || tiles.length === 0) return [];
  const size = Math.max(1, Math.floor(perPage));
  const pages = [];
  for (let i = 0; i < tiles.length; i += size) {
    pages.push({ tiles: tiles.slice(i, i + size) });
  }
  return pages;
}
