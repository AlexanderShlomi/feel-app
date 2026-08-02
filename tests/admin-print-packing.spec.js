// Pure-logic tests for the admin print packing/ordering guarantees.
//
// These exist because the mosaic tiles were reaching the printed sheet in an
// order the customer never chose. The ordering contract is now asserted rather
// than assumed. No browser/dev-server needed: printPacking.js has no imports.

import { test, expect } from '@playwright/test';
import {
  expandMosaicToTiles,
  expandMagnetsTiles,
  flattenTilesForBatch,
  chunkTilesIntoPages,
  collectMosaicRefs,
  computeMosaicGridDims,
  collectTileIssues,
  groupIssuesByOrder,
  countTilesByOrder,
  ordersOnPage,
  buildBatchManifest,
  suggestOptimalBatch,
  ITEMS_PER_PAGE,
  BATCH_COLS
} from '../src/lib/admin/printPacking.js';

/** A 4x3 mosaic: the case that exposed the bug (cols != the sheet's 3). */
function mosaicItem() {
  return {
    id: 'item-1',
    item_type: 'mosaic',
    configuration: {
      count: 12,
      settingsMeta: {
        gridBaseSize: 3,
        splitImageRatio: 4 / 3,
        splitTransform: { zoom: 1.2, xPct: 0.25, yPct: -0.5 },
        currentEffect: 'noir'
      }
    },
    original_storage_paths: { source: 'orders/o1/source.jpg' }
  };
}

test('sheet geometry constants stay consistent with the A4 layout', () => {
  expect(BATCH_COLS).toBe(3);
  expect(ITEMS_PER_PAGE).toBe(15);
});

test('mosaic grid dims follow the editor formula', () => {
  // Landscape 4:3 at base 3 -> 4 cols x 3 rows, exactly as the editor renders.
  expect(computeMosaicGridDims(3, 4 / 3, 12)).toEqual({ cols: 4, rows: 3 });
  // Portrait 3:4 -> taller than wide.
  expect(computeMosaicGridDims(3, 3 / 4, 12)).toEqual({ cols: 3, rows: 4 });
  // Square fallback when the ratio is unknown and count gives nothing.
  expect(computeMosaicGridDims(3, null, null)).toEqual({ cols: 3, rows: 3 });
});

test('mosaic expands in strict reading order (row-major, col 0 first)', () => {
  const tiles = expandMosaicToTiles(mosaicItem());
  expect(tiles).toHaveLength(12);

  // This is the contract the printed sheet depends on: index i must be
  // (row = floor(i / cols), col = i % cols). Any deviation scrambles the photo.
  const seen = tiles.map((t) => `${t.cropRect.row},${t.cropRect.col}`);
  const expected = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) expected.push(`${row},${col}`);
  }
  expect(seen).toEqual(expected);
});

test('every mosaic tile carries the customer transform and effect verbatim', () => {
  const tiles = expandMosaicToTiles(mosaicItem());
  for (const t of tiles) {
    // Law A: the crop the customer composed must survive to the sheet intact.
    expect(t.transform).toEqual({ zoom: 1.2, xPct: 0.25, yPct: -0.5 });
    expect(t.effect).toBe('noir');
    expect(t.imageRatio).toBeCloseTo(4 / 3);
    expect(t.storagePath).toBe('orders/o1/source.jpg');
  }
});

test('hidden magnets are dropped and explicit order is honoured', () => {
  const tiles = expandMagnetsTiles({
    configuration: {
      magnetsMeta: [
        { id: 'c', order: 2, xPct: 0, yPct: 0, zoom: 1 },
        { id: 'a', order: 0, xPct: 0, yPct: 0, zoom: 1 },
        { id: 'gone', order: 1, hidden: true },
        { id: 'b', order: 1, xPct: 0, yPct: 0, zoom: 1 }
      ]
    },
    original_storage_paths: { a: 'p/a.jpg', b: 'p/b.jpg', c: 'p/c.jpg' }
  });

  expect(tiles.map((t) => t.storagePath)).toEqual(['p/a.jpg', 'p/b.jpg', 'p/c.jpg']);
});

test('flattened batch keeps each mosaic contiguous and in reading order', () => {
  const orders = [{ id: 'o1', order_number: 101 }];
  const itemsByOrder = { o1: [mosaicItem()] };

  const flat = flattenTilesForBatch(orders, itemsByOrder, {});
  expect(flat).toHaveLength(12);
  expect(flat.every((t) => t.kind === 'mosaic')).toBe(true);

  // Reading order preserved through the flatten step.
  expect(flat.map((t) => `${t.cropRect.row},${t.cropRect.col}`)).toEqual(
    expandMosaicToTiles(mosaicItem()).map((t) => `${t.cropRect.row},${t.cropRect.col}`)
  );
});

test('paging never reorders or drops tiles', () => {
  const orders = [
    { id: 'o1', order_number: 101 },
    { id: 'o2', order_number: 102 }
  ];
  const itemsByOrder = { o1: [mosaicItem()], o2: [mosaicItem()] };

  const flat = flattenTilesForBatch(orders, itemsByOrder, {});
  const pages = chunkTilesIntoPages(flat, ITEMS_PER_PAGE);

  expect(pages).toHaveLength(Math.ceil(24 / ITEMS_PER_PAGE));
  // Concatenating the pages must reproduce the flat stream exactly.
  const rejoined = pages.flatMap((p) => p.tiles);
  expect(rejoined).toEqual(flat);
  expect(pages.every((p) => p.tiles.length <= ITEMS_PER_PAGE)).toBe(true);
});

test('mosaic references describe the whole grid for the preview', () => {
  const orders = [{ id: 'o1', order_number: 101 }];
  const refs = collectMosaicRefs(orders, { o1: [mosaicItem()] });

  expect(refs).toHaveLength(1);
  expect(refs[0]).toMatchObject({
    orderNumber: 101,
    cols: 4,
    rows: 3,
    effect: 'noir',
    storagePath: 'orders/o1/source.jpg'
  });
  // Reference and sheet must agree on the grid, or the admin compares a
  // picture against tiles that were cut to a different geometry.
  const tiles = expandMosaicToTiles(mosaicItem());
  expect(refs[0].cols).toBe(tiles[0].cropRect.cols);
  expect(refs[0].rows).toBe(tiles[0].cropRect.rows);
  expect(refs[0].transform).toEqual(tiles[0].transform);
});

test('non-mosaic orders produce no mosaic references', () => {
  const refs = collectMosaicRefs([{ id: 'o1', order_number: 1 }], {
    o1: [{ item_type: 'magnets_pack', configuration: { magnetsMeta: [] } }]
  });
  expect(refs).toEqual([]);
});

// ── Integrity ────────────────────────────────────────────────────────────────
// These cover the failure that shipped blank magnets: a tile with no usable
// image rendered as an anonymous grey square, never blocked the ready flag, and
// went to paper.

test('a magnet with no stored original is reported, not silently blank', () => {
  const orders = [{ id: 'o1', order_number: 101 }];
  const itemsByOrder = {
    o1: [
      {
        item_type: 'magnets_pack',
        configuration: {
          magnetsMeta: [
            { id: 'a', order: 0, xPct: 0, yPct: 0, zoom: 1 },
            { id: 'b', order: 1, xPct: 0, yPct: 0, zoom: 1 }
          ]
        },
        // 'b' never uploaded — orderOriginals.js swallows upload failures.
        original_storage_paths: { a: 'p/a.jpg' }
      }
    ]
  };

  const tiles = flattenTilesForBatch(orders, itemsByOrder, {});
  const issues = collectTileIssues(tiles, { 'p/a.jpg': 'https://signed/a' });

  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({ orderNumber: 101, reason: 'no_path', index: 1 });
});

test('a path that failed to sign is distinguished from one that never existed', () => {
  const tiles = [
    { orderId: 'o1', orderNumber: 101, storagePath: 'p/a.jpg' },
    { orderId: 'o1', orderNumber: 101, storagePath: '' }
  ];
  const issues = collectTileIssues(tiles, {}); // nothing signed

  expect(issues.map((i) => i.reason)).toEqual(['no_url', 'no_path']);
});

test('an image that failed to decode is an issue even though it was signed', () => {
  const tiles = [{ orderId: 'o1', orderNumber: 101, storagePath: 'p/a.jpg' }];
  const signed = { 'p/a.jpg': 'https://signed/a' };

  expect(collectTileIssues(tiles, signed)).toEqual([]);
  expect(collectTileIssues(tiles, signed, new Set(['p/a.jpg']))[0].reason).toBe('load_failed');
});

test('a gift item with no image becomes a reported tile, not a vanished one', () => {
  const orders = [{ id: 'o1', order_number: 101 }];
  const itemsByOrder = { o1: [{ item_type: 'gift', configuration: {}, original_storage_paths: {} }] };

  const tiles = flattenTilesForBatch(orders, itemsByOrder, {});
  // Dropping it used to short-ship a paid magnet AND make the flattened count
  // disagree with the queue estimate for no visible reason.
  expect(tiles).toHaveLength(1);
  expect(tiles[0].isGift).toBe(true);
  expect(collectTileIssues(tiles, {})[0]).toMatchObject({ reason: 'no_path', label: 'מגנט מתנה' });
});

test('issues collapse to one row per order with a capped detail list', () => {
  const tiles = Array.from({ length: 9 }, (_, i) => ({
    orderId: 'o1',
    orderNumber: 101,
    storagePath: '',
    cropRect: { col: i % 3, row: Math.floor(i / 3), cols: 3, rows: 3 }
  }));

  const rows = groupIssuesByOrder(collectTileIssues(tiles, {}));
  expect(rows).toHaveLength(1);
  expect(rows[0].count).toBe(9);
  // A fully broken mosaic must not render a 9-line banner.
  expect(rows[0].labels.length).toBeLessThanOrEqual(4);
});

// ── Sheet / batch reporting ──────────────────────────────────────────────────

test('per-order tile counts come from the flattened stream', () => {
  const orders = [
    { id: 'o1', order_number: 101 },
    { id: 'o2', order_number: 102 }
  ];
  const tiles = flattenTilesForBatch(orders, { o1: [mosaicItem()], o2: [mosaicItem()] }, {});
  expect(countTilesByOrder(tiles)).toEqual({ o1: 12, o2: 12 });
});

test('a sheet reports every order it carries, in layout order', () => {
  const orders = [
    { id: 'o1', order_number: 101 },
    { id: 'o2', order_number: 102 }
  ];
  const flat = flattenTilesForBatch(orders, { o1: [mosaicItem()], o2: [mosaicItem()] }, {});
  const pages = chunkTilesIntoPages(flat, ITEMS_PER_PAGE);

  // 12 + 12 tiles over 15-tile sheets: the first sheet straddles both orders.
  expect(ordersOnPage(pages[0])).toEqual([101, 102]);
  expect(ordersOnPage(pages[1])).toEqual([102]);
});

test('the manifest carries the greeting and notes the sheets cannot', () => {
  const orders = [{ id: 'o1', order_number: 101, shipping_first_name: 'דנה', shipping_last_name: 'לוי' }];
  const itemsByOrder = {
    o1: [
      mosaicItem(),
      { item_type: 'gift', configuration: {}, original_storage_paths: { gift: 'p/g.jpg' } }
    ]
  };
  const jobsByOrder = { o1: { gift_message: 'מזל טוב!', admin_notes: 'לארוז בנפרד' } };

  const tiles = flattenTilesForBatch(orders, itemsByOrder, jobsByOrder);
  const [row] = buildBatchManifest(orders, itemsByOrder, jobsByOrder, countTilesByOrder(tiles));

  expect(row).toMatchObject({
    orderNumber: 101,
    customerName: 'דנה לוי',
    tileCount: 13,
    hasGift: true,
    giftMessage: 'מזל טוב!',
    adminNotes: 'לארוז בנפרד'
  });
  expect(row.breakdown).toEqual(
    expect.arrayContaining([
      { type: 'mosaic', count: 12 },
      { type: 'gift', count: 1 }
    ])
  );
});

// ── Batch suggestion ─────────────────────────────────────────────────────────

test('an oversized order is skipped, not treated as the end of the queue', () => {
  const queue = [
    { id: 'huge', visible_tile_count: ITEMS_PER_PAGE * 11 }, // over the 10-page cap
    // 7 + 8 = one perfectly full sheet, so both are needed to hit the target.
    { id: 'a', visible_tile_count: 7 },
    { id: 'b', visible_tile_count: 8 }
  ];

  const result = suggestOptimalBatch(queue);
  // The previous `break` hid every order behind the oversized one.
  expect(result.selectedIds).toEqual(['a', 'b']);
  expect(result.skippedIds).toEqual(['huge']);
  expect(result.utilization).toBe(1);
});

test('an oldest order that alone overflows is still offered, and flagged', () => {
  const queue = [{ id: 'huge', visible_tile_count: ITEMS_PER_PAGE * 11 }];
  const result = suggestOptimalBatch(queue);

  // Returning an empty selection here deadlocked the queue with no explanation.
  expect(result.selectedIds).toEqual(['huge']);
  expect(result.exceedsMaxPages).toBe(true);
});
