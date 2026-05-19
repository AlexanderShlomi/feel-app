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

  function getTilesForOrder(orderId) {
    const items = itemsByOrder[orderId] || [];
    const tiles = [];
    for (const item of items) {
      if (item.item_type === 'mosaic') {
        const mosaicTiles = expandMosaicToTiles(item);
        for (const t of mosaicTiles) {
          tiles.push({ type: 'mosaic', storagePath: t.storagePath, cropRect: t.cropRect });
        }
      } else {
        const magnetTiles = expandMagnetsTiles(item);
        for (const t of magnetTiles) {
          tiles.push({ type: 'magnet', storagePath: t.storagePath, meta: t.meta });
        }
      }
    }
    return tiles;
  }

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

  function getMosaicStyle(cropRect) {
    const { col, row, gridSize } = cropRect;
    // Show 1/gridSize of the image, positioned to reveal the correct cell
    const scale = gridSize; // image is scaled up gridSize times
    const offsetX = -(col * TILE_PX);
    const offsetY = -(row * TILE_PX);
    return `width:${TILE_PX * gridSize}px;height:${TILE_PX * gridSize}px;position:absolute;left:${offsetX}px;top:${offsetY}px;`;
  }
</script>

<section class="a4-page">
  {#each pageData.orders as order, oi}
    {@const tiles = getTilesForOrder(order.id)}
    {#if oi > 0}
      <div class="inter-order-gap"></div>
    {/if}
    <div class="order-header">
      — הזמנה #{order.order_number} — לקוח: {order.name} — {order.visible_tile_count} מגנטים —
    </div>
    <div class="tiles-grid">
      {#each tiles as tile, ti}
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
              style={getMosaicStyle(tile.cropRect)}
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
    grid-template-columns: repeat(3, 50mm);
    gap: 5mm;
    justify-content: center;
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
