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

// Row height including gap
export const ROW_H_MM = TILE_MM + GAP_MM; // 55

/**
 * Tiles per page on the standard A4-portrait sheet.
 * Layout math: usable 190×277mm; tile+gap = 55mm; 3 cols × 5 rows = 15.
 */
export const ITEMS_PER_PAGE = 15;
export const BATCH_COLS = 3;

// ── Suggestion engine ─────────────────────────────────────────────────────────

/**
 * Suggest an optimal batch of orders from the queue that fills pages efficiently.
 * Greedy: starts from the oldest, adds orders until utilization target is met or maxPages reached.
 *
 * @param {Array<{id: string, visible_tile_count: number, [key: string]: any}>} queue
 * @param {number} maxPages
 * @param {number} utilizationTarget
 * @returns {{selectedIds: string[], utilization: number}}
 */
export function suggestOptimalBatch(queue, maxPages = 10, utilizationTarget = 0.9) {
  if (!queue || queue.length === 0) return { selectedIds: [], utilization: 0 };

  const selected = [];
  let bestResult = null;

  for (const order of queue) {
    selected.push(order);
    const totalTiles = selected.reduce((s, o) => s + (o.visible_tile_count || 0), 0);
    const pages = Math.ceil(totalTiles / ITEMS_PER_PAGE);

    if (pages > maxPages) {
      selected.pop();
      break;
    }

    const util = pages > 0 ? totalTiles / (pages * ITEMS_PER_PAGE) : 0;
    bestResult = { selectedIds: selected.map(o => o.id), utilization: util };

    if (util >= utilizationTarget) break;
  }

  return bestResult || { selectedIds: [], utilization: 0 };
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
 * @param {number | string} orderNumber
 * @returns {{ storagePath: string, meta: { xPct: number, yPct: number, zoom: number, activeEffectId: string }, isGift: true } | null}
 */
export function expandGiftTile(item, jobData, orderNumber) {
  // Prefer admin-overridden image; fall back to original gift image in storage.
  const storagePath =
    jobData?.gift_image_path ||
    item.original_storage_paths?.gift ||
    item.configuration?.giftImage_path ||
    '';

  if (!storagePath) return null;

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
        const giftTile = expandGiftTile(item, jobData, order.order_number);
        if (giftTile) {
          out.push({
            kind: 'magnet',
            orderId: order.id,
            orderNumber: order.order_number,
            storagePath: giftTile.storagePath,
            meta: giftTile.meta,
            isGift: true
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
