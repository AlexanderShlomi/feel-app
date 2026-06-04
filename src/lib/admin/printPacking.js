// Admin print packing algorithm — pure functions, no DOM dependency.
// Lays out visible magnets/tiles from multiple orders onto A4 pages.

// ── Constants (mm) ────────────────────────────────────────────────────────────
export const TILE_MM = 50;
export const GAP_MM = 5;
export const PAGE_W_MM = 210;
export const PAGE_H_MM = 297;
export const PAGE_MARGIN_MM = 10;

// Usable area inside page margins
export const USABLE_W_MM = PAGE_W_MM - PAGE_MARGIN_MM * 2; // 190
export const USABLE_H_MM = PAGE_H_MM - PAGE_MARGIN_MM * 2; // 277

// Number of columns that fit: floor((190 + 5) / (50 + 5)) = 3
export const COLS = Math.floor((USABLE_W_MM + GAP_MM) / (TILE_MM + GAP_MM)); // 3

// Header band height (order separator) — enough for a single line of text
export const HEADER_MM = 6;

// Gap between orders on the same page
export const INTER_ORDER_GAP_MM = 4;

// Row height including gap
export const ROW_H_MM = TILE_MM + GAP_MM; // 55

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * How many rows an order needs, given its visible tile count.
 */
export function rowsNeeded(visibleCount) {
  return Math.ceil(visibleCount / COLS);
}

/**
 * Height in mm that an order block occupies (header + rows + inter-row gaps).
 */
export function orderBlockHeight(visibleCount) {
  const rows = rowsNeeded(visibleCount);
  // rows of tiles + (rows-1) gaps + header
  return HEADER_MM + rows * TILE_MM + (rows - 1) * GAP_MM;
}

/**
 * Pack an array of orders into pages using first-fit (FIFO order — oldest first).
 * Each order starts on a new row; orders never split across pages.
 *
 * @param {Array<{id: string, order_number: number|string, shipping_first_name: string, shipping_last_name: string, visible_tile_count: number}>} orders
 * @returns {Array<{orders: Array<{id: string, order_number: number|string, name: string, visible_tile_count: number, startRow: number}>, usedHeight: number}>}
 */
export function packOrdersIntoPages(orders) {
  if (!orders || orders.length === 0) return [];

  /** @type {Array<{orders: any[], usedHeight: number}>} */
  const pages = [];

  for (const order of orders) {
    const blockH = orderBlockHeight(order.visible_tile_count);

    // If a single order is taller than the usable area, it gets its own page(s).
    if (blockH > USABLE_H_MM) {
      // Split into continuation pages
      const tilesPerPage = COLS * Math.floor((USABLE_H_MM - HEADER_MM + GAP_MM) / ROW_H_MM);
      let remaining = order.visible_tile_count;
      while (remaining > 0) {
        const batch = Math.min(remaining, tilesPerPage);
        const batchH = orderBlockHeight(batch);
        pages.push({
          orders: [{
            id: order.id,
            order_number: order.order_number,
            name: `${order.shipping_first_name || ''} ${order.shipping_last_name || ''}`.trim(),
            visible_tile_count: batch,
            startRow: 0
          }],
          usedHeight: batchH
        });
        remaining -= batch;
      }
      continue;
    }

    // Try to fit into the last existing page
    const last = pages[pages.length - 1];
    const extraGap = last && last.orders.length > 0 ? INTER_ORDER_GAP_MM : 0;

    if (last && last.usedHeight + extraGap + blockH <= USABLE_H_MM) {
      last.orders.push({
        id: order.id,
        order_number: order.order_number,
        name: `${order.shipping_first_name || ''} ${order.shipping_last_name || ''}`.trim(),
        visible_tile_count: order.visible_tile_count,
        startRow: 0 // will be computed during render
      });
      last.usedHeight += extraGap + blockH;
    } else {
      // Start a new page
      pages.push({
        orders: [{
          id: order.id,
          order_number: order.order_number,
          name: `${order.shipping_first_name || ''} ${order.shipping_last_name || ''}`.trim(),
          visible_tile_count: order.visible_tile_count,
          startRow: 0
        }],
        usedHeight: blockH
      });
    }
  }

  return pages;
}

/**
 * Suggest an optimal batch of orders from the queue that fills pages efficiently.
 * Greedy: starts from the oldest, adds orders until utilization target is met or maxPages reached.
 *
 * @param {Array<{id: string, visible_tile_count: number, [key: string]: any}>} queue
 * @param {number} maxPages - max pages to fill (default 10)
 * @param {number} utilizationTarget - target utilization ratio (default 0.9)
 * @returns {{selectedIds: string[], pages: ReturnType<typeof packOrdersIntoPages>, utilization: number}}
 */
export function suggestOptimalBatch(queue, maxPages = 10, utilizationTarget = 0.9) {
  if (!queue || queue.length === 0) return { selectedIds: [], pages: [], utilization: 0 };

  const selected = [];
  let bestResult = null;

  for (const order of queue) {
    selected.push(order);
    const pages = packOrdersIntoPages(selected);

    if (pages.length > maxPages) {
      selected.pop();
      break;
    }

    const totalUsed = pages.reduce((s, p) => s + p.usedHeight, 0);
    const totalCapacity = pages.length * USABLE_H_MM;
    const util = totalCapacity > 0 ? totalUsed / totalCapacity : 0;

    bestResult = { selectedIds: selected.map(o => o.id), pages, utilization: util };

    if (util >= utilizationTarget) break;
  }

  return bestResult || { selectedIds: [], pages: [], utilization: 0 };
}

/**
 * Compute the mosaic grid dimensions (cols × rows) the editor renders.
 * Mirrors the algorithm in `src/routes/uploader/+layout.svelte`
 * (`calculateAndRenderSplitGrid`):
 *
 *   if imageRatio > 1 (landscape):  cols = round(base * imageRatio); rows = base
 *   else (portrait/square):         rows = round(base / imageRatio); cols = base
 *
 * Legacy fallback: if the order configuration was written before
 * `splitImageRatio` started being stored, we infer dimensions from
 * `count` (total visible tiles) and `gridBaseSize` — one of the two is the
 * base; whichever choice yields `cols × rows === count` wins.
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
    // Landscape candidate: cols = count / base, rows = base
    if (count % safeBase === 0) {
      const cols = count / safeBase;
      if (cols >= safeBase) return { cols, rows: safeBase };
      return { cols: safeBase, rows: cols };
    }
  }

  // Last resort: assume square grid.
  return { cols: safeBase, rows: safeBase };
}

/**
 * Expand a mosaic item into individual tile descriptors.
 *
 * Mosaic = one source image divided evenly into `cols × rows` tiles. Each tile
 * gets:
 *   - storagePath: the SAME source image (every tile points at the original)
 *   - cropRect:    which cell of the grid this tile is (col, row, cols, rows)
 *   - transform:   the user's chosen zoom + pan (xPct/yPct) — applied during
 *                  render so the printed slice matches the editor preview
 *   - effect:      the user's chosen CSS effect filter id
 *   - imageRatio:  natural image aspect ratio (may be null for legacy data;
 *                  PrintPage.svelte falls back to img.naturalWidth/Height)
 *
 * Critical Law A invariant: this metadata MUST be enough to reproduce the
 * exact frame the user saw in the mosaic editor. Anything missing will
 * surface as a wrong crop / wrong effect on the printed sheet.
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

/**
 * Extract visible magnet tiles from a magnets_pack item.
 *
 * @param {{configuration: {magnetsMeta?: any[]}, original_storage_paths?: Record<string, string>}} item
 * @returns {Array<{storagePath: string, meta: {xPct: number, yPct: number, zoom: number, activeEffectId?: string}}>}
 */
export function expandMagnetsTiles(item) {
  const meta = item.configuration?.magnetsMeta || [];
  const paths = item.original_storage_paths || {};
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

/**
 * Returns true when any item on this packed page is a mosaic wider than
 * the default 3-tile A4-portrait row. Used by the preview wrapper to swap
 * to landscape dimensions so the tiles aren't clipped.
 *
 * @param {{ orders: Array<{ id: string }> }} page
 * @param {Record<string, Array<any>>} itemsByOrder
 * @returns {boolean}
 */
export function pageNeedsLandscape(page, itemsByOrder) {
  if (!page || !Array.isArray(page.orders)) return false;
  for (const order of page.orders) {
    const items = itemsByOrder?.[order.id] || [];
    for (const item of items) {
      if (item.item_type !== 'mosaic') continue;
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
      const { cols } = computeMosaicGridDims(base, imageRatio, count);
      if (cols > 3) return true;
    }
  }
  return false;
}

// ── Smart Batching / Nesting Engine ──────────────────────────────────────────
// The functions below implement a "flat batching" print pipeline:
//   1. Flatten every visible tile (magnet or expanded mosaic cell) from ALL
//      selected orders into a single array — each tile carries its source
//      order_number so the operator can sort post-cut.
//   2. Chunk that array into fixed-size pages (ITEMS_PER_PAGE).
//   3. Each printed tile is a hard 50mm × 50mm physical block with a tiny
//      "#Order-NNN" label in the bleed area for post-print sorting.
//
// This differs from packOrdersIntoPages (which keeps each order grouped with
// its own header). Use this engine when you want to maximize paper utilization
// across many small orders.

/**
 * Tiles per page on the standard A4-portrait sheet.
 * Layout math: usable 190×277mm; tile+gap = 55mm; 3 cols × 5 rows = 15.
 * If you change page size, recompute and update this constant.
 */
export const ITEMS_PER_PAGE = 15;
export const BATCH_COLS = 3;

/**
 * Flatten every visible tile across the supplied orders into one array.
 * Each entry carries enough metadata for PrintBatchPage to render it at
 * pixel-perfect 50mm × 50mm with the correct crop / effect, plus the
 * `orderNumber` used for the cut-label.
 *
 * @param {Array<{id: string, order_number: number|string}>} orders
 * @param {Record<string, Array<any>>} itemsByOrder
 * @returns {Array<{
 *   kind: 'magnet' | 'mosaic',
 *   orderId: string,
 *   orderNumber: number | string,
 *   storagePath: string,
 *   meta?: { xPct: number, yPct: number, zoom: number, activeEffectId: string },
 *   cropRect?: { col: number, row: number, cols: number, rows: number },
 *   transform?: { zoom: number, xPct: number, yPct: number },
 *   effect?: string,
 *   imageRatio?: number | null
 * }>}
 */
export function flattenTilesForBatch(orders, itemsByOrder) {
  const out = [];
  if (!Array.isArray(orders)) return out;
  for (const order of orders) {
    const items = itemsByOrder?.[order.id] || [];
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
 * Flatten ONLY magnet (collection) tiles across the supplied orders.
 * Used by the hybrid print pipeline: mosaics are rendered in their native
 * grid (preserving puzzle structure), magnets are packed into a flat 3×5
 * grid for paper efficiency.
 *
 * @param {Array<{id: string, order_number: number|string}>} orders
 * @param {Record<string, Array<any>>} itemsByOrder
 * @returns {Array<{kind: 'magnet', orderId: string, orderNumber: number|string, storagePath: string, meta: any}>}
 */
export function flattenMagnetTilesOnly(orders, itemsByOrder) {
  const out = [];
  if (!Array.isArray(orders)) return out;
  for (const order of orders) {
    const items = itemsByOrder?.[order.id] || [];
    for (const item of items) {
      if (item.item_type === 'mosaic') continue;
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

