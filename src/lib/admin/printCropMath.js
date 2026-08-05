// Shared crop geometry for every admin print surface.
//
// WHY THIS MODULE EXISTS
// This math was previously duplicated verbatim in PrintPage.svelte and
// PrintBatchPage.svelte. Law A requires the editor frame, the preview and the
// printed sheet to reproduce the SAME pixels; three hand-maintained copies of
// the same formula is exactly how that invariant drifts. One copy, imported
// everywhere.
//
// UNITS
// 50mm @ 300dpi = 591px is the logical frame. Every returned size/offset is a
// PERCENTAGE of its frame, never a raw pixel. The DOM parent is sized in mm:
// the browser maps 50mm to ~189px on screen @96dpi and to 591px at print
// @300dpi. Returning raw pixels would overflow the on-screen box by 3x and
// show only the top-left corner. Percentages stay pixel-perfect at any DPI.

import { computeCoverBaseSize, computeMaxTranslateFromBase, pctToTranslate } from '$lib/utils/cropMath.js';
import { getCssFilter } from '$lib/stores.js';

export const TILE_PX = 591;

/** Percentage of a single 50mm tile frame. */
const pctOfTile = (v) => (v / TILE_PX) * 100;

/**
 * Serialize a frame rect into the inline style every print surface applies to
 * its <img>. `max-width/max-height:none` guards against a global
 * `img { max-width: 100% }` reset compressing the image back into its box and
 * silently discarding the user's zoom.
 */
function toStyle(widthPct, heightPct, leftPct, topPct, filter) {
  return (
    `width:${widthPct}%;height:${heightPct}%;` +
    `position:absolute;left:${leftPct}%;top:${topPct}%;` +
    `max-width:none;max-height:none;filter:${filter};`
  );
}

/**
 * Sentinel returned before the image's natural dimensions are known. Showing
 * an unscaled image here flashed a wrong/uncropped tile at the admin while the
 * signed URL was still downloading; hiding is the correct interim state. The
 * on:load handler overwrites img.style, which clears the visibility.
 */
export const HIDDEN_STYLE = 'visibility:hidden;';

/**
 * Inline style for one magnet tile (a single 50mm square, cover-fit + pan/zoom).
 *
 * @param {{xPct: number, yPct: number, zoom: number, activeEffectId?: string}} meta
 * @param {number} imgNatW
 * @param {number} imgNatH
 * @returns {string}
 */
export function getMagnetTileStyle(meta, imgNatW, imgNatH) {
  if (!imgNatW || !imgNatH) return HIDDEN_STYLE;

  const { baseW, baseH } = computeCoverBaseSize(imgNatW, imgNatH, TILE_PX);
  const zoom = meta.zoom || 1;
  const { maxX, maxY } = computeMaxTranslateFromBase(baseW, baseH, TILE_PX, zoom);
  const { x, y } = pctToTranslate(meta.xPct, meta.yPct, maxX, maxY);

  const scaledW = baseW * zoom;
  const scaledH = baseH * zoom;
  const left = (TILE_PX - scaledW) / 2 + x;
  const top = (TILE_PX - scaledH) / 2 + y;

  return toStyle(
    pctOfTile(scaledW),
    pctOfTile(scaledH),
    pctOfTile(left),
    pctOfTile(top),
    getCssFilter(meta.activeEffectId)
  );
}

/**
 * Core mosaic geometry: cover-fit the source image over the FULL cols x rows
 * grid, apply the customer's zoom, then pan by xPct/yPct across the symmetric
 * overflow on each axis.
 *
 * Mirrors `calculateAndRenderSplitGrid` in src/routes/uploader/+layout.svelte,
 * which is the frame the customer actually composed (Law A).
 *
 * @returns {{totalW: number, totalH: number, finalW: number, finalH: number,
 *            startX: number, startY: number} | null} null when the aspect
 *          ratio is not yet resolvable.
 */
export function computeMosaicGeometry(cols, rows, transform, imageRatioFromMeta, imgNatW, imgNatH) {
  // Prefer the ratio stored at order time (exactly what the customer saw);
  // fall back to the loaded image for legacy orders predating splitImageRatio.
  let imageRatio = null;
  if (typeof imageRatioFromMeta === 'number' && imageRatioFromMeta > 0) {
    imageRatio = imageRatioFromMeta;
  } else if (imgNatW && imgNatH) {
    imageRatio = imgNatW / imgNatH;
  } else {
    return null;
  }

  const totalW = cols * TILE_PX;
  const totalH = rows * TILE_PX;
  const gridAspect = totalW / totalH;

  // Cover-fit: one axis matches exactly, the other overflows symmetrically.
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

  return {
    totalW,
    totalH,
    finalW,
    finalH,
    startX: (totalW - finalW) / 2 + xPct * maxX,
    startY: (totalH - finalH) / 2 + yPct * maxY
  };
}

/**
 * Inline style for ONE mosaic cell: the 50mm window onto cell (col, row) of the
 * full grid. Used by the printed cutting sheet.
 *
 * @param {{col: number, row: number, cols: number, rows: number}} cropRect
 */
export function getMosaicTileStyle(cropRect, transform, effect, imageRatioFromMeta, imgNatW, imgNatH) {
  const { col, row, cols, rows } = cropRect;
  const g = computeMosaicGeometry(cols, rows, transform, imageRatioFromMeta, imgNatW, imgNatH);
  if (!g) return HIDDEN_STYLE;

  // Slide the whole image so this cell's window lands over the 50mm frame.
  return toStyle(
    pctOfTile(g.finalW),
    pctOfTile(g.finalH),
    pctOfTile(g.startX - col * TILE_PX),
    pctOfTile(g.startY - row * TILE_PX),
    getCssFilter(effect)
  );
}

/**
 * Inline style for the WHOLE assembled mosaic (no per-cell offset), expressed
 * as percentages of the full grid frame rather than one tile. Used by the
 * on-screen reference in the print preview.
 */
export function getMosaicWholeStyle(cols, rows, transform, effect, imageRatioFromMeta, imgNatW, imgNatH) {
  const g = computeMosaicGeometry(cols, rows, transform, imageRatioFromMeta, imgNatW, imgNatH);
  if (!g) return HIDDEN_STYLE;

  return toStyle(
    (g.finalW / g.totalW) * 100,
    (g.finalH / g.totalH) * 100,
    (g.startX / g.totalW) * 100,
    (g.startY / g.totalH) * 100,
    getCssFilter(effect)
  );
}
