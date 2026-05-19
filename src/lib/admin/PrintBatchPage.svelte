<script>
  /**
   * Flat-batch print page.
   *
   * Renders one A4 sheet from a flat tile array (mixed orders) chunked by
   * `chunkTilesIntoPages`. Each tile is a hard 50mm × 50mm physical block
   * with a tiny "#Order-NNN" cut-label in the bleed area so the operator
   * can sort the cut magnets back to their source order after the
   * guillotine cut.
   *
   * Crop math is intentionally identical to `PrintPage.svelte` so the
   * printed pixels match the editor frame-for-frame (Law A).
   */
  import {
    computeCoverBaseSize,
    computeMaxTranslateFromBase,
    pctToTranslate
  } from '$lib/utils/cropMath.js';
  import { getCssFilter } from '$lib/stores.js';

  /**
   * @type {{
   *   pageData: {
   *     tiles: Array<{
   *       kind: 'magnet' | 'mosaic',
   *       orderNumber: number | string,
   *       storagePath: string,
   *       meta?: { xPct: number, yPct: number, zoom: number, activeEffectId: string },
   *       cropRect?: { col: number, row: number, cols: number, rows: number },
   *       transform?: { zoom: number, xPct: number, yPct: number },
   *       effect?: string,
   *       imageRatio?: number | null
   *     }>
   *   },
   *   signedUrls: Record<string, string>
   * }}
   */
  export let pageData;
  export let signedUrls;

  // 50mm @ 300dpi = 591px — logical frame used by the crop math (kept
  // identical to PrintPage.svelte so the math stays in lock-step).
  //
  // CRITICAL: all returned sizes/offsets are expressed as PERCENTAGES of
  // this logical frame. Why: the parent .print-tile is sized in mm (50mm).
  // At screen preview the browser maps 50mm → ~189px @96dpi; at print it
  // maps 50mm → 591px @300dpi. If we returned raw pixels (e.g. 591px) the
  // image would overflow the 189px on-screen container by 3× and the user
  // would see only the top-left corner — reading as a distorted face.
  // Percentages keep the crop pixel-perfect at every DPI (Law A).
  const TILE_PX = 591;
  const pct = (v) => (v / TILE_PX) * 100;

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
    return (
      `width:${pct(scaledW)}%;height:${pct(scaledH)}%;` +
      `position:absolute;left:${pct(left)}%;top:${pct(top)}%;` +
      `max-width:none;max-height:none;filter:${filter};`
    );
  }

  function getMosaicStyle(cropRect, transform, effect, imageRatioFromMeta, imgNatW, imgNatH) {
    const { col, row, cols, rows } = cropRect;
    let imageRatio = null;
    if (typeof imageRatioFromMeta === 'number' && imageRatioFromMeta > 0) {
      imageRatio = imageRatioFromMeta;
    } else if (imgNatW && imgNatH) {
      imageRatio = imgNatW / imgNatH;
    } else {
      const fallbackW = TILE_PX * cols;
      const fallbackH = TILE_PX * rows;
      const offsetX = -(col * TILE_PX);
      const offsetY = -(row * TILE_PX);
      const filter = getCssFilter(effect);
      return (
        `width:${pct(fallbackW)}%;height:${pct(fallbackH)}%;` +
        `position:absolute;left:${pct(offsetX)}%;top:${pct(offsetY)}%;` +
        `max-width:none;max-height:none;filter:${filter};`
      );
    }

    const totalW = cols * TILE_PX;
    const totalH = rows * TILE_PX;
    const gridAspect = totalW / totalH;
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
    return (
      `width:${pct(finalW)}%;height:${pct(finalH)}%;` +
      `position:absolute;left:${pct(left)}%;top:${pct(top)}%;` +
      `max-width:none;max-height:none;filter:${filter};`
    );
  }
</script>

<section class="batch-page">
  <div class="batch-grid">
    {#each pageData.tiles as tile}
      {@const url = signedUrls[tile.storagePath] || ''}
      <!--
        Two-layer structure:
          .batch-cell  — 50×50mm grid item, overflow:visible (hosts the label
                         that protrudes above the tile at top:-3.5mm).
          .print-tile  — 50×50mm, overflow:hidden (crops the image to the
                         physical square the guillotine will cut to).
        The label MUST live inside .batch-cell (sibling of .print-tile) so
        it isn't clipped by the tile's overflow:hidden. Both are absolutely
        positioned-anchored to .batch-cell.
      -->
      <div class="batch-cell">
        <span class="cut-label">#Order-{tile.orderNumber}</span>
        <div class="print-tile">
        {#if tile.kind === 'magnet' && url}
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
        {:else if tile.kind === 'mosaic' && url}
          <img
            src={url}
            alt=""
            class="tile-img"
            style={getMosaicStyle(tile.cropRect, tile.transform, tile.effect, tile.imageRatio, 0, 0)}
            on:load={(e) => {
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
        <span class="crop-mark crop-mark--tl"></span>
        <span class="crop-mark crop-mark--tr"></span>
        <span class="crop-mark crop-mark--bl"></span>
        <span class="crop-mark crop-mark--br"></span>
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .batch-page {
    width: 210mm;
    height: 297mm;
    /* Page geometry (A4 portrait):
         padding 8mm top/bot + 5 rows × 50mm + 4 row-gaps × 5mm
         = 16 + 250 + 20 = 286mm < 297mm  (11mm slack — safe).
       The top padding is ≥ 4mm so the absolute cut-label (top:-3.5mm)
       on the first row never gets clipped at the paper edge. */
    padding: 8mm 5mm;
    box-sizing: border-box;
    background: white;
    position: relative;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .batch-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }

  /* Rigid 3×5 grid — !important guards against any cascade override that
     could collapse the columns at print time (some browsers reset display
     to inline-block on print roots). */
  .batch-grid {
    display: grid !important;
    grid-template-columns: repeat(3, 50mm) !important;
    grid-auto-rows: 50mm !important;
    gap: 5mm !important;
    justify-content: center !important;
    align-content: start !important;
  }

  /* Cell wrapper — same physical size as the tile, but overflow:visible so
     the cut-label that protrudes above (top:-3.5mm) is not clipped. */
  .batch-cell {
    width: 50mm;
    height: 50mm;
    position: relative;
    overflow: visible;
  }

  .print-tile {
    /* HARD physical size — mm so the printer maps it to 50mm of paper at
       any DPI. position:relative anchors the absolutely-positioned image,
       label and crop-marks. */
    width: 50mm;
    height: 50mm;
    position: relative;
    overflow: hidden;
    background: #f9f9f9;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }

  .cut-label {
    /* Pulled OUT of the 50mm tile (top:-3.5mm) so it can't push the grid
       row taller. Lives in the 5mm row-gap above this tile. z-index above
       the image because .print-tile is overflow:hidden — but the label is
       outside the tile vertically so visibility relies on the parent
       .batch-page not clipping; 8mm top padding ensures it shows on row 1. */
    position: absolute;
    top: -3.5mm;
    left: 0;
    right: 0;
    text-align: center;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 6pt;
    line-height: 1;
    color: #444;
    letter-spacing: 0.02em;
    pointer-events: none;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }

  /* Image is positioned absolutely with percentage units relative to the
     50mm tile (see getMagnetStyle / getMosaicStyle). max-width:none guards
     against any global "img{max-width:100%}" reset that would compress the
     image back into the box and break the user-chosen crop. */
  .tile-img {
    display: block;
    max-width: none;
    max-height: none;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }

  .tile-placeholder {
    width: 100%;
    height: 100%;
    background: #eee;
  }

  /* Corner crop marks — hairlines in the bleed for the guillotine. */
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
