// Shared decoder for image natural geometry (width/height).
// Single source-of-truth used by the magnet editor and any future consumer that
// needs identical dimensions for crop math, so xPct/yPct stays stable across
// editor↔grid even when the editor renders from a preview blob.
//
// EXIF handling: relies on `<img>` decoding (browser applies EXIF orientation),
// matching the rendering path used in `Magnet.svelte` and the editor's
// `<img class="editor-source-img">`. Avoid `createImageBitmap` here — some
// browsers ignore EXIF even with imageOrientation hints.

const SIZE_CACHE_MAX = 32;
/** @type {Map<string, Promise<{ w: number, h: number }>>} */
const cache = new Map();

function lruTouch(key, value) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    if (cache.size > SIZE_CACHE_MAX) {
        const firstKey = cache.keys().next().value;
        if (firstKey) cache.delete(firstKey);
    }
}

/**
 * Decode an image URL and return its natural dimensions. Cached per URL.
 * Resolves with `{ w: 0, h: 0 }` on error.
 *
 * @param {string} url
 * @returns {Promise<{ w: number, h: number }>}
 */
export function decodeNaturalSize(url) {
    if (!url) return Promise.resolve({ w: 0, h: 0 });
    const hit = cache.get(url);
    if (hit) return hit;

    const promise = new Promise((resolve) => {
        try {
            if (typeof Image === 'undefined') return resolve({ w: 0, h: 0 });
            const img = new Image();
            img.decoding = 'async';
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
            };
            img.onload = finish;
            img.onerror = () => {
                if (settled) return;
                settled = true;
                resolve({ w: 0, h: 0 });
            };
            img.src = url;
            // decode() avoids blank frame races on iOS; not universal — onload is the safety net.
            if (typeof img.decode === 'function') {
                img.decode().then(finish).catch(finish);
            }
        } catch {
            resolve({ w: 0, h: 0 });
        }
    });

    lruTouch(url, promise);
    return promise;
}

/** Drop a single URL from the cache (useful before revoking a blob: URL). */
export function forgetNaturalSize(url) {
    if (!url) return;
    cache.delete(url);
}

export function clearImageGeometryCache() {
    cache.clear();
}
