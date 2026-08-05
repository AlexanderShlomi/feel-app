<script>
  /**
   * Flat-batch print page.
   *
   * Renders one A4 sheet from a flat tile array (mixed orders) chunked by
   * `chunkTilesIntoPages`. Each tile is a hard 50mm x 50mm physical block
   * with a tiny "#Order-NNN" cut-label in the bleed area so the operator
   * can sort the cut magnets back to their source order after the
   * guillotine cut.
   *
   * All crop geometry lives in $lib/admin/printCropMath.js so the preview,
   * the printed sheet and the assembled-mosaic reference cannot drift apart
   * (Law A).
   */
  import { getMagnetTileStyle, getMosaicTileStyle } from '$lib/admin/printCropMath.js';

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
</script>

<section class="batch-page">
  <div class="batch-grid">
    {#each pageData.tiles as tile}
      {@const url = signedUrls[tile.storagePath] || ''}
      <!--
        Two-layer structure:
          .batch-cell  -- 50×50mm grid item, overflow:visible (hosts the label
                         that protrudes above the tile at top:-3.5mm).
          .print-tile  -- 50×50mm, overflow:hidden (crops the image to the
                         physical square the guillotine will cut to).
        The label MUST live inside .batch-cell (sibling of .print-tile) so
        it isn't clipped by the tile's overflow:hidden. Both are absolutely
        positioned-anchored to .batch-cell.
      -->
      <div class="batch-cell">
        <!--
          Per-tile cut-label. For magnets: "#Order-NN" is enough -- sort order.
          For mosaic cells: append the (col,row) coordinates so the customer
          can reassemble the puzzle on their fridge after the magnets are cut
          and shipped (we no longer preserve the mosaic grid on the printed
          sheet -- tiles are nested for paper efficiency).

          NOTE: these are real Unicode characters, NOT escape-sequence escapes.
          Svelte template text is HTML text -- a backslash escape is not
          interpreted there and would print the literal seven characters
          onto the paper.
        -->
        {#if tile.kind === 'mosaic' && tile.cropRect}
          <span class="cut-label">#Order-{tile.orderNumber} &bull; {tile.cropRect.col + 1}/{tile.cropRect.cols},{tile.cropRect.row + 1}/{tile.cropRect.rows}</span>
        {:else if tile.isGift}
          <span class="cut-label">#Order-{tile.orderNumber} &#127873;</span>
        {:else}
          <span class="cut-label">#Order-{tile.orderNumber}</span>
        {/if}
        <div class="print-tile">
        {#if tile.kind === 'magnet' && url}
          <img
            src={url}
            alt=""
            class="tile-img"
            data-path={tile.storagePath}
            style={getMagnetTileStyle(tile.meta, 0, 0)}
            on:load={(e) => {
              const img = e.target;
              img.style = getMagnetTileStyle(tile.meta, img.naturalWidth, img.naturalHeight);
            }}
          />
        {:else if tile.kind === 'mosaic' && url}
          <img
            src={url}
            alt=""
            class="tile-img"
            data-path={tile.storagePath}
            style={getMosaicTileStyle(tile.cropRect, tile.transform, tile.effect, tile.imageRatio, 0, 0)}
            on:load={(e) => {
              if (tile.imageRatio == null) {
                const img = e.target;
                img.style = getMosaicTileStyle(
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
          <!--
            No usable image for this tile. This used to be a silent grey square
            that the guillotine happily cut into a blank magnet. The batch is
            now blocked before print (see collectTileIssues in printPacking.js);
            this marker is the on-screen explanation of WHICH square is broken.
            Screen only — a blocked batch never reaches paper, and printing a
            warning onto a magnet would be worse than printing nothing.
          -->
          <div class="tile-placeholder">
            <span class="tile-placeholder-mark">⚠<br />תמונה חסרה</span>
          </div>
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
    /* 286mm content (8×2 padding + 5×50mm tiles + 4×5mm gaps) < 296mm.
       min-height avoids sub-pixel overflow accumulation that some browsers
       round up to 297mm, triggering an extra blank page. */
    min-height: 296mm;
    /* Page geometry (A4 portrait):
         padding 8mm top/bot + 5 rows × 50mm + 4 row-gaps × 5mm
         = 16 + 250 + 20 = 286mm < 296mm  (10mm slack -- safe).
       The top padding is ≥ 4mm so the absolute cut-label (top:-3.5mm)
       on the first row never gets clipped at the paper edge. */
    padding: 8mm 5mm;
    box-sizing: border-box;
    background: white;
    position: relative;
    overflow: hidden;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }

  /* Rigid 3×5 grid -- !important guards against any cascade override that
     could collapse the columns at print time (some browsers reset display
     to inline-block on print roots). */
  .batch-grid {
    display: grid !important;
    /* CRITICAL (Law A): the admin shell is dir="rtl" (see admin/+layout.svelte),
       and CSS Grid honours the inherited direction -- items would flow
       right-to-left, placing mosaic column 0 at the FAR RIGHT and mirroring
       every mosaic row against what the customer composed in the editor.
       The tile stream from flattenTilesForBatch is strictly reading-order
       (row-major, left-to-right), so the sheet must be laid out LTR
       regardless of the surrounding Hebrew UI direction. */
    direction: ltr !important;
    grid-template-columns: repeat(3, 50mm) !important;
    grid-auto-rows: 50mm !important;
    gap: 5mm !important;
    justify-content: center !important;
    align-content: start !important;
  }

  /* Cell wrapper -- same physical size as the tile, but overflow:visible so
     the cut-label that protrudes above (top:-3.5mm) is not clipped. */
  .batch-cell {
    width: 50mm;
    height: 50mm;
    position: relative;
    overflow: visible;
  }

  .print-tile {
    /* HARD physical size -- mm so the printer maps it to 50mm of paper at
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
       the image because .print-tile is overflow:hidden -- but the label is
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
    background: repeating-linear-gradient(
      45deg,
      #fdecea,
      #fdecea 4mm,
      #f8d7d3 4mm,
      #f8d7d3 8mm
    );
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tile-placeholder-mark {
    font-size: 9pt;
    font-weight: 700;
    line-height: 1.3;
    text-align: center;
    color: #c62828;
    direction: rtl;
  }

  @media print {
    /* Belt and braces: the batch cannot be printed while a tile is broken, but
       if that guard is ever bypassed the paper must not carry admin warnings. */
    .tile-placeholder { background: #f9f9f9; }
    .tile-placeholder-mark { display: none; }
  }

  /* Corner crop marks -- hairlines in the bleed for the guillotine. */
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

  @media print {
    .batch-page {
      overflow: visible;
      break-inside: avoid;
      page-break-inside: avoid;
      /* In print, drop the screen-side 296mm floor -- content is 286mm,
         and a 10mm forced floor combined with sub-pixel rounding can push
         the box past 297mm. The trailing-blank-page bug that originally
         required min-height is now handled by the
         .page-preview-wrapper + .page-preview-wrapper page-break-before
         selector in +page.svelte. */
      min-height: 0;
      height: auto;
    }
  }
</style>
