// Lightweight grid preview generator for the magnets-pack collection grid.
//
// Why two-tier rendering?
// ───────────────────────
// `originalSrc` (full-resolution blob) is the source of truth for:
//   • the single-magnet editor (`uploader/edit/[magnetId]`)
//   • order thumbnails (`orderThumbnails.js`)
//   • cart re-hydration after autosave
//
// On mobile, a 12MP camera photo (~5 MB JPEG, 4032×3024) tells the browser to
// decode roughly 50 MB of bitmap data per tile when `content-visibility:auto`
// reveals it during scroll. Each tile decode can cost 80–250 ms on mid-range
// devices and is a primary cause of jank when scrolling through 30+ magnets.
//
// The grid only needs a tile-sized image (~150–180 CSS px on phones, so ~360
// physical px at @2x). A 900-px-max preview at JPEG q=0.85 is visually
// indistinguishable inside the tile and decodes 10–20× faster.
//
// This helper is mobile-first; desktop keeps using the original blob to avoid
// any quality compromise where decode is cheap (~30–60 ms for 12MP).

import PreviewWorker from '$lib/workers/imagePreview.worker.js?worker';

const PREVIEW_MAX_DIM = 900;
const PREVIEW_QUALITY = 0.85;
const PREVIEW_MIME = 'image/jpeg';

/**
 * Generate a downscaled grid preview from a Blob/File.
 *
 * Uses `<img>` decoding (not `createImageBitmap`) so EXIF orientation matches
 * exactly what the browser renders for `<img class="magnet-image">` — important
 * for portrait-vs-landscape detection inside `Magnet.svelte`.
 *
 * @param {Blob | File} blob
 * @param {{ maxDim?: number, quality?: number, mimeType?: string }} [opts]
 * @returns {Promise<string | null>} Object URL of a JPEG preview, or null on failure.
 */
export async function createGridPreviewFromBlob(blob, opts = {}) {
    if (!blob || typeof document === 'undefined') return null;

    const maxDim = opts.maxDim || PREVIEW_MAX_DIM;
    const quality = opts.quality ?? PREVIEW_QUALITY;
    const mime = opts.mimeType || PREVIEW_MIME;

    let probeUrl = null;
    try {
        probeUrl = URL.createObjectURL(blob);

        const img = new Image();
        img.decoding = 'async';
        img.src = probeUrl;
        if (typeof img.decode === 'function') {
            await img.decode().catch(() => {});
        } else {
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
            }).catch(() => {});
        }

        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (!w || !h) return null;

        const scale = Math.min(1, maxDim / Math.max(w, h));
        if (scale >= 1) {
            // Image already smaller than target — return the same blob as a URL
            // (a fresh one to keep ownership predictable for the caller).
            return URL.createObjectURL(blob);
        }

        const outW = Math.max(1, Math.round(w * scale));
        const outH = Math.max(1, Math.round(h * scale));

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return null;

        ctx.drawImage(img, 0, 0, outW, outH);

        const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
        if (!outBlob) return null;
        return URL.createObjectURL(outBlob);
    } catch {
        return null;
    } finally {
        if (probeUrl) {
            try { URL.revokeObjectURL(probeUrl); } catch {}
        }
    }
}

// ── Worker-backed variant ───────────────────────────────────────────────────
// Keeps the heavy decode + resample off the UI thread so a batch upload of many
// 12MP photos stays at 60fps. Falls back to the main-thread helper above when
// the worker is unavailable (older Safari without OffscreenCanvas) or errors.

/** @type {Worker | null} */
let _worker = null;
let _workerSeq = 0;
let _workerUnavailable = false;
/** @type {Map<number, (v: { blob: Blob | null, passthrough?: boolean } | null) => void>} */
const _workerPending = new Map();

function getPreviewWorker() {
    if (_workerUnavailable || typeof window === 'undefined') return null;
    if (_worker) return _worker;
    try {
        _worker = new PreviewWorker();
        _worker.onmessage = (e) => {
            const { id } = e.data || {};
            const resolve = _workerPending.get(id);
            if (!resolve) return;
            _workerPending.delete(id);
            resolve(e.data);
        };
        _worker.onerror = () => {
            // Hard worker failure — resolve everything pending so callers can
            // fall back, and stop using the worker for the rest of the session.
            _workerUnavailable = true;
            for (const resolve of _workerPending.values()) resolve(null);
            _workerPending.clear();
            try { _worker && _worker.terminate(); } catch {}
            _worker = null;
        };
        return _worker;
    } catch {
        _workerUnavailable = true;
        return null;
    }
}

/**
 * Generate a downscaled grid preview off the main thread.
 * Same contract as {@link createGridPreviewFromBlob}: returns an Object URL of a
 * JPEG preview, or null on failure.
 *
 * @param {Blob | File} blob
 * @param {{ maxDim?: number, quality?: number, mimeType?: string }} [opts]
 * @returns {Promise<string | null>}
 */
export async function createGridPreviewViaWorker(blob, opts = {}) {
    if (!blob || typeof window === 'undefined') return null;

    const worker = getPreviewWorker();
    if (!worker) return createGridPreviewFromBlob(blob, opts);

    const maxDim = opts.maxDim || PREVIEW_MAX_DIM;
    const quality = opts.quality ?? PREVIEW_QUALITY;
    const mime = opts.mimeType || PREVIEW_MIME;
    const id = ++_workerSeq;

    const msg = await new Promise((resolve) => {
        _workerPending.set(id, resolve);
        try {
            worker.postMessage({ id, blob, maxDim, quality, mime });
        } catch {
            _workerPending.delete(id);
            resolve(null);
        }
    });

    // Worker errored / disappeared, or it couldn't decode — retry on main thread.
    if (!msg || (!msg.blob && !msg.passthrough)) {
        return createGridPreviewFromBlob(blob, opts);
    }
    // Image already smaller than the target — reuse the original blob untouched.
    if (msg.passthrough) return URL.createObjectURL(blob);
    return URL.createObjectURL(msg.blob);
}
