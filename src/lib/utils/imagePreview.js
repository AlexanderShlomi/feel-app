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
