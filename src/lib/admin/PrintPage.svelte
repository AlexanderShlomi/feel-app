<script>
  import { computeCoverBaseSize, computeMaxTranslateFromBase, pctToTranslate } from '$lib/utils/cropMath.js';
  import { getCssFilter } from '$lib/stores.js';
  import { TILE_MM, GAP_MM, COLS, HEADER_MM, INTER_ORDER_GAP_MM, PAGE_MARGIN_MM } from '$lib/admin/printPacking.js';
  import { expandMosaicToTiles, expandMagnetsTiles } from '$lib/admin/printPacking.js';

  /**
   * @type {{
   *   pageData: {orders: Array<{id: string, order_number: string|number, name: string, visible_tile_count: number}>},
   *   itemsByOrder: Record<string, Array<any>>,
   *   signedUrls: Record<string, string>
   * }}
   */
  export let pageData;
  export let itemsByOrder;
  export let signedUrls;

  // Pixel size for each tile at 300dpi: 50mm = ~591px
  const TILE_PX = 591;

  // Magnets are not part of a logical grid → keep current 3-col page packing.
  const MAGNETS_DEFAULT_COLS = 3;

  /**
   * Group an order's items into per-item "blocks" so each block is rendered
   * in its OWN grid with the correct cols × rows.
   *
   * Critical bug fix (Law A): previously every order shared a single 3-col
   * grid, so a 4×3 mosaic was scrambled into a 3×4 visual layout — the
   * printed tiles no longer matched the user's selected mosaic. Each mosaic
   * must use its actual `cols` (from imageRatio + gridBaseSize) so the
   * printed sheet visually reconstructs what the user saw in the editor.
   */
  function getItemBlocksForOrder(orderId) {
    const items = itemsByOrder[orderId] || [];
    const blocks = [];
    for (const item of items) {
      if (item.item_type === 'mosaic') {
        const mosaicTiles = expandMosaicToTiles(item);
        const first = mosaicTiles[0];
        const cols = first?.cropRect?.cols || 1;
        const rows = first?.cropRect?.rows || 1;
        blocks.push({
          kind: 'mosaic',
          cols,
          rows,
          tiles: mosaicTiles.map((t) => ({
            type: 'mosaic',
            storagePath: t.storagePath,
            cropRect: t.cropRect,
            transform: t.transform,
            effect: t.effect,
            imageRatio: t.imageRatio
          }))
        });
      } else {
        const magnetTiles = expandMagnetsTiles(item);
        if (magnetTiles.length === 0) continue;
        blocks.push({
          kind: 'magnets',
          cols: MAGNETS_DEFAULT_COLS,
          rows: Math.ceil(magnetTiles.length / MAGNETS_DEFAULT_COLS),
          tiles: magnetTiles.map((t) => ({
            type: 'magnet',
            storagePath: t.storagePath,
            meta: t.meta
          }))
        });
      }
    }
    return blocks;
  }

  /**
   * A page must be printed on A4 landscape when any block on it is wider
   * than 3 tiles (e.g. a 4×3 mosaic). Otherwise the rightmost tiles get
   * clipped off the page. Preview applies the orientation visually so the
   * admin sees exactly what will print.
   */
  $: pageIsLandscape = (pageData.orders || []).some((o) =>
    getItemBlocksForOrder(o.id).some((b) => b.cols > 3)
  );

  function getMagnetStyle(meta, imgNatW, imgNatH) {
    if (!imgNatW || !imgNatH) return '';
    const { baseW, baseH } = computeCoverBaseSize(imgNatW, imgNatH, TILE_PX);
    const zoom = meta.zoom || 1;
    const { maxX, maxY } = computeMaxTranslateFromBase(baseW, baseH, TILE_PX, zoom);
    const { x, y } = pctToTranslate(meta.xPct, meta.yPct, maxX, maxY);
    const scaledW = baseW * zoom;
    const scaledH = baseH * zoom;
    const left = (TILE_PX - scaledW) / 2 + x;
    const top = (TILE_PX - scaledH) / 2 + y;
    const filter = getCssFilter(meta.activeEffectId);
    return `width:${scaledW}px;height:${scaledH}px;position:absolute;left:${left}px;top:${top}px;filter:${filter};`;
  }

  /**
   * Render the slice of the mosaic source image that belongs to cell
   * (cropRect.col, cropRect.row) within a `cols × rows` grid.
   *
   * Mirrors the editor algorithm in src/routes/uploader/+layout.svelte
   * (`calculateAndRenderSplitGrid`):
   *   1. Cover the total grid (cols·TILE_PX × rows·TILE_PX) with the image at
   *      the natural aspect ratio (`imageRatio`). One axis matches exactly,
   *      the other overflows symmetrically.
   *   2. Multiply by the user's zoom.
   *   3. Shift by xPct·maxX / yPct·maxY (each in [-1..1] of the symmetric
   *      overflow on its axis).
   *   4. Subtract `(col, row) · TILE_PX` to position THIS tile's window over
   *      the full image.
   *   5. Apply the chosen CSS filter so the printed effect matches what the
   *      user saw in the editor.
   *
   * Falls back gracefully: if `imageRatio` was not stored in settingsMeta
   * (legacy data), we use the loaded image's natural dimensions instead — the
   * onload handler in the template calls this again with the right ratio.
   *
   * @param {{ col: number; row: number; cols: number; rows: number }} cropRect
   * @param {{ zoom: number; xPct: number; yPct: number }} transform
   * @param {string} effect
   * @param {number | null} imageRatioFromMeta
   * @param {number} imgNatW
   * @param {number} imgNatH
   * @returns {string}
   */
  function getMosaicStyle(cropRect, transform, effect, imageRatioFromMeta, imgNatW, imgNatH) {
    const { col, row, cols, rows } = cropRect;

    // Resolve imageRatio: prefer stored value (matches what the user saw in
    // the editor exactly), fall back to the loaded image's natural ratio for
    // legacy orders predating the splitImageRatio field.
    let imageRatio = null;
    if (typeof imageRatioFromMeta === 'number' && imageRatioFromMeta > 0) {
      imageRatio = imageRatioFromMeta;
    } else if (imgNatW && imgNatH) {
      imageRatio = imgNatW / imgNatH;
    } else {
      // No info yet — render a default cover so the tile is at least visible;
      // onload will recompute with the natural ratio.
      const fallbackW = TILE_PX * cols;
      const fallbackH = TILE_PX * rows;
      const offsetX = -(col * TILE_PX);
      const offsetY = -(row * TILE_PX);
      const filter = getCssFilter(effect);
      return `width:${fallbackW}px;height:${fallbackH}px;position:absolute;left:${offsetX}px;top:${offsetY}px;filter:${filter};`;
    }

    const totalW = cols * TILE_PX;
    const totalH = rows * TILE_PX;
    const gridAspect = totalW / totalH;

    // Cover-fit (one axis matches, the other overflows symmetrically).
    let bgW;
    let bgH;
    if (imageRatio > gridAspect) {
      bgH = totalH;
      bgW = bgH * imageRatio;
    } else {
      bgW = totalW;
      bgH = bgW / imageRatio;
    }

    const zoom = transform?.zoom > 0 ? transform.zoom : 1;
    const finalW = bgW * zoom;
    const finalH = bgH * zoom;

    const maxX = Math.max(0, (finalW - totalW) / 2);
    const maxY = Math.max(0, (finalH - totalH) / 2);
    const xPct = Math.max(-1, Math.min(1, transform?.xPct ?? 0));
    const yPct = Math.max(-1, Math.min(1, transform?.yPct ?? 0));
    const shiftX = xPct * maxX;
    const shiftY = yPct * maxY;

    const startX = (totalW - finalW) / 2 + shiftX;
    const startY = (totalH - finalH) / 2 + shiftY;

    const left = startX - col * TILE_PX;
    const top = startY - row * TILE_PX;
    const filter = getCssFilter(effect);

    return `width:${finalW}px;height:${finalH}px;position:absolute;left:${left}px;top:${top}px;filter:${filter};`;
  }
</script>

<section class="a4-page" class:a4-page--landscape={pageIsLandscape}>
  {#each pageData.orders as order, oi}
    {@const blocks = getItemBlocksForOrder(order.id)}
    {#if oi > 0}
      <div class="inter-order-gap"></div>
    {/if}
    <div class="order-header">
      — הזמנה #{order.order_number} — לקוח: {order.name} — {order.visible_tile_count} מגנטים —
    </div>
    {#each blocks as block}
      <div
        class="tiles-grid"
        class:tiles-grid--wide={block.cols > 3}
        style="grid-template-columns: repeat({block.cols}, 50mm);"
      >
        {#each block.tiles as tile}
          {@const url = signedUrls[tile.storagePath] || ''}
          <div class="print-tile">
            {#if tile.type === 'magnet' && url}
              <img
                src={url}
                alt=""
                class="tile-img"
                style={getMagnetStyle(tile.meta, 0, 0)}
                on:load={(e) => {
                  const img = e.target;
                  img.style = getMagnetStyle(tile.meta, img.naturalWidth, img.naturalHeight);
                }}
              />
            {:else if tile.type === 'mosaic' && url}
              <img
                src={url}
                alt=""
                class="tile-img"
                style={getMosaicStyle(tile.cropRect, tile.transform, tile.effect, tile.imageRatio, 0, 0)}
                on:load={(e) => {
                  /* Legacy fallback: if splitImageRatio was not stored at order
                     time, recompute using the loaded image's natural ratio so
                     the printed crop still matches the source aspect. */
                  if (tile.imageRatio == null) {
                    const img = e.target;
                    img.style = getMosaicStyle(
                      tile.cropRect,
                      tile.transform,
                      tile.effect,
                      null,
                      img.naturalWidth,
                      img.naturalHeight
                    );
                  }
                }}
              />
            {:else}
              <div class="tile-placeholder"></div>
            {/if}
            <!-- Crop marks -->
            <span class="crop-mark crop-mark--tl"></span>
            <span class="crop-mark crop-mark--tr"></span>
            <span class="crop-mark crop-mark--bl"></span>
            <span class="crop-mark crop-mark--br"></span>
          </div>
        {/each}
      </div>
    {/each}
  {/each}
</section>

<style>
  .a4-page {
    width: 210mm;
    height: 297mm;
    padding: 10mm;
    box-sizing: border-box;
    background: white;
    position: relative;
    overflow: hidden;
    page-break-after: always;
  }
  /* A4 landscape — used when any item on the page is wider than 3 tiles
     (e.g. a 4×3 mosaic). Both dimensions swap so the on-screen preview
     matches the physical sheet the operator will load into the printer. */
  .a4-page--landscape {
    width: 297mm;
    height: 210mm;
  }
  .a4-page:last-child {
    page-break-after: auto;
  }

  .order-header {
    height: 6mm;
    line-height: 6mm;
    font-size: 9pt;
    font-weight: 700;
    text-align: center;
    color: #333;
    border-bottom: 0.3mm solid #999;
    margin-bottom: 2mm;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .inter-order-gap {
    height: 4mm;
  }

  .tiles-grid {
    display: grid;
    /* grid-template-columns is set inline per item (mosaic uses its real cols;
       magnets use the default 3). This is critical for mosaics whose
       imageRatio yields cols ≠ 3 — hardcoding 3 columns scrambled the tiles
       into the wrong physical positions (Law A: print must match editor). */
    gap: 5mm;
    justify-content: center;
  }
  .tiles-grid + .tiles-grid {
    margin-top: 4mm;
  }
  /* Visual cue for the operator: a mosaic wider than 3 columns will exceed
     A4 portrait width — must be printed on A4 landscape. Preview is allowed
     to overflow horizontally so the layout remains visually correct. */
  .tiles-grid--wide {
    grid-auto-flow: row;
  }

  .print-tile {
    width: 50mm;
    height: 50mm;
    position: relative;
    overflow: hidden;
    background: #f9f9f9;
  }

  .tile-img {
    display: block;
  }

  .tile-placeholder {
    width: 100%;
    height: 100%;
    background: #eee;
  }

  /* Crop marks — thin lines at corners */
  .crop-mark {
    position: absolute;
    display: block;
    pointer-events: none;
  }
  .crop-mark::before,
  .crop-mark::after {
    content: '';
    position: absolute;
    background: #000;
  }
  .crop-mark--tl { top: -1mm; left: -1mm; }
  .crop-mark--tl::before { width: 3mm; height: 0.2mm; top: 0; left: 0; }
  .crop-mark--tl::after { width: 0.2mm; height: 3mm; top: 0; left: 0; }

  .crop-mark--tr { top: -1mm; right: -1mm; }
  .crop-mark--tr::before { width: 3mm; height: 0.2mm; top: 0; right: 0; }
  .crop-mark--tr::after { width: 0.2mm; height: 3mm; top: 0; right: 0; }

  .crop-mark--bl { bottom: -1mm; left: -1mm; }
  .crop-mark--bl::before { width: 3mm; height: 0.2mm; bottom: 0; left: 0; }
  .crop-mark--bl::after { width: 0.2mm; height: 3mm; bottom: 0; left: 0; }

  .crop-mark--br { bottom: -1mm; right: -1mm; }
  .crop-mark--br::before { width: 3mm; height: 0.2mm; bottom: 0; right: 0; }
  .crop-mark--br::after { width: 0.2mm; height: 3mm; bottom: 0; right: 0; }
</style>
