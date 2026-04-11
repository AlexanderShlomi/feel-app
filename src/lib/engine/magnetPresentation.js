/**
 * Pure presentation math for magnet tiles — single source for editor + thumbnails.
 * @import { computeCoverBaseSize, computeMaxTranslateFromBase, pctToTranslate, clamp } from '$lib/utils/cropMath.js';
 */
import { computeCoverBaseSize, computeMaxTranslateFromBase, pctToTranslate, clamp } from '$lib/utils/cropMath.js';

const LEGACY_FRAME_SIZE = 300;

/** @param {string} effectId */
export function getCssFilter(effectId) {
	switch (effectId) {
		case 'silver':
			return 'grayscale(1) contrast(1.08) brightness(1.05)';
		case 'noir':
			return 'grayscale(1) contrast(1.35) brightness(0.95)';
		case 'vivid':
			return 'saturate(1.35) contrast(1.12) brightness(1.03)';
		case 'dramatic':
			return 'saturate(1.18) contrast(1.22) brightness(0.98)';
		case 'original':
		default:
			return 'none';
	}
}

/** @param {string} effectId */
export function getFilterStyle(effectId) {
	const f = getCssFilter(effectId);
	return `filter: ${f}; -webkit-filter: ${f};`;
}

/**
 * @param {import('./productSchema.js').MagnetLike} magnet
 * @param {import('./productSchema.js').MagnetRenderMetrics | null | undefined} metrics
 * @param {number} [layoutRefreshEpoch]
 */
export function computeMagnetPresentation(magnet, metrics, layoutRefreshEpoch = 0) {
	void layoutRefreshEpoch;
	const tr = magnet.transform;
	const isSplitPart = !!magnet.isSplitPart;
	/** Law A: same full-res URL as editor (`originalSrc || src`), never a downscaled preview. */
	const rasterUrl = magnet.originalSrc || magnet.src;
	const activeEffectId = magnet.activeEffectId ?? 'original';
	const filterCss = getFilterStyle(activeEffectId);

	const hasTransform = !!(
		tr &&
		((typeof tr.xPct === 'number' && tr.xPct !== 0) ||
			(typeof tr.yPct === 'number' && tr.yPct !== 0) ||
			(typeof tr.x === 'number' && tr.x !== 0) ||
			(typeof tr.y === 'number' && tr.y !== 0) ||
			tr.zoom !== 1)
	);

	if (isSplitPart && tr && 'bgWidth' in tr) {
		const fw = metrics?.frameSize || magnet.size || 150;
		return {
			filterCss,
			hasTransform: true,
			cssVars: `
        --magnet-size: ${fw}px;
        --zoom: 1;
        --tx: 0px;
        --ty: 0px;
        --base-w: ${fw}px;
        --base-h: ${fw}px;
        --bg-w: ${tr.bgWidth}px;
        --bg-h: ${tr.bgHeight}px;
        --bg-x: ${tr.bgPosX}px;
        --bg-y: ${tr.bgPosY}px;
        --bg-url: url('${rasterUrl}');
    `
		};
	}

	const frameSize =
		metrics?.frameSize != null && metrics.frameSize > 0
			? metrics.frameSize
			: magnet.size || 150;
	const naturalW = metrics?.naturalW ?? 0;
	const naturalH = metrics?.naturalH ?? 0;
	const isImageLoaded = naturalW > 0 && naturalH > 0;

	const z = tr?.zoom ?? 1;
	if (!isImageLoaded || !frameSize) {
		const c = { z, tx: 0, ty: 0, bw: frameSize || 0, bh: frameSize || 0 };
		const fw = frameSize || 150;
		return {
			filterCss,
			hasTransform,
			cssVars: `
        --magnet-size: ${fw}px;
        --zoom: ${c.z};
        --tx: ${c.tx}px;
        --ty: ${c.ty}px;
        --base-w: ${fw}px;
        --base-h: ${fw}px;
        --bg-w: 0px;
        --bg-h: 0px;
        --bg-x: 0px;
        --bg-y: 0px;
        --bg-url: url('${rasterUrl}');
    `
		};
	}

	const { baseW: bw, baseH: bh } = computeCoverBaseSize(naturalW, naturalH, frameSize);
	const { maxX, maxY } = computeMaxTranslateFromBase(bw, bh, frameSize, z);
	let tx = 0;
	let ty = 0;
	if (typeof tr?.xPct === 'number' || typeof tr?.yPct === 'number') {
		const t = pctToTranslate(tr?.xPct, tr?.yPct, maxX, maxY);
		tx = t.x;
		ty = t.y;
	} else {
		const legacyX = typeof tr?.x === 'number' ? tr.x : 0;
		const legacyY = typeof tr?.y === 'number' ? tr.y : 0;
		tx = clamp(legacyX * LEGACY_FRAME_SIZE, -maxX, maxX);
		ty = clamp(legacyY * LEGACY_FRAME_SIZE, -maxY, maxY);
	}
	const c = { z, tx, ty, bw, bh };
	const fw = frameSize || 150;
	return {
		filterCss,
		hasTransform,
		cssVars: `
        --magnet-size: ${fw}px;
        --zoom: ${c.z};
        --tx: ${c.tx}px;
        --ty: ${c.ty}px;
        --base-w: ${c.bw}px;
        --base-h: ${c.bh}px;
        --bg-w: 0px;
        --bg-h: 0px;
        --bg-x: 0px;
        --bg-y: 0px;
        --bg-url: url('${rasterUrl}');
    `
	};
}
