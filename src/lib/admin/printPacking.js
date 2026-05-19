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
 * Expand a mosaic item into individual tile descriptors.
 * Mosaic = one source image divided evenly into gridBaseSize² tiles.
 * Each tile gets a cropRect describing which portion of the source to show.
 *
 * @param {{configuration: {settingsMeta?: {gridBaseSize?: number}}, original_storage_paths?: {source?: string}}} item
 * @returns {Array<{storagePath: string, cropRect: {col: number, row: number, gridSize: number}}>}
 */
export function expandMosaicToTiles(item) {
  const gridSize = item.configuration?.settingsMeta?.gridBaseSize || 3;
  const storagePath = item.original_storage_paths?.source || '';
  const tiles = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      tiles.push({ storagePath, cropRect: { col, row, gridSize } });
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
