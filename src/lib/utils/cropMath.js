// Shared crop math for editor + grid to avoid drift across platforms.

export function clamp(n, min, max) {
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

function getDpr() {
    try {
        return (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    } catch {
        return 1;
    }
}

// Snap values to device pixels to avoid iOS subpixel transform drift.
export function snapPx(value) {
    const dpr = getDpr();
    return Math.round((value || 0) * dpr) / dpr;
}

export function computeCoverMinScale(imgW, imgH, frame) {
    const scaleX = frame / imgW;
    const scaleY = frame / imgH;
    return Math.max(scaleX, scaleY);
}

export function computeCoverBaseSize(imgW, imgH, frame) {
    const minScale = computeCoverMinScale(imgW, imgH, frame);
    return {
        baseW: Math.max(1, snapPx(imgW * minScale)),
        baseH: Math.max(1, snapPx(imgH * minScale)),
        minScale
    };
}

export function computeMaxTranslateFromBase(baseW, baseH, frame, zoom = 1) {
    const currentW = (baseW || 0) * (zoom || 1);
    const currentH = (baseH || 0) * (zoom || 1);
    return {
        maxX: Math.max(0, snapPx((currentW - frame) / 2)),
        maxY: Math.max(0, snapPx((currentH - frame) / 2))
    };
}

export function pctToTranslate(xPct, yPct, maxX, maxY) {
    return {
        x: snapPx(clamp(typeof xPct === 'number' ? xPct : 0, -1, 1) * (maxX || 0)),
        y: snapPx(clamp(typeof yPct === 'number' ? yPct : 0, -1, 1) * (maxY || 0))
    };
}

export function translateToPct(x, y, maxX, maxY) {
    return {
        xPct: maxX > 0 ? (x / maxX) : 0,
        yPct: maxY > 0 ? (y / maxY) : 0
    };
}

