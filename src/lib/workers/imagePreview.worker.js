// Off-main-thread grid preview generator.
//
// Mirrors the resampling math in `createGridPreviewFromBlob()`
// (src/lib/utils/imagePreview.js) but runs inside a Web Worker so decoding +
// canvas downscaling of 12MP camera photos never blocks the UI thread while a
// user uploads many images at once.
//
// EXIF orientation: the main-thread helper deliberately avoids
// `createImageBitmap` because some browsers ignore EXIF there. Here we opt in
// explicitly with `{ imageOrientation: 'from-image' }`, which bakes the
// rotation into the bitmap so the preview matches exactly what an `<img>`
// renders for the tile (portrait/landscape detection in Magnet.svelte).

self.onmessage = async (e) => {
    const { id, blob, maxDim = 900, quality = 0.85, mime = 'image/jpeg' } = e.data || {};

    const fail = (extra) => self.postMessage({ id, blob: null, ...extra });

    try {
        if (
            !blob ||
            typeof createImageBitmap !== 'function' ||
            typeof OffscreenCanvas === 'undefined'
        ) {
            return fail({ unsupported: true });
        }

        const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        const w = bitmap.width;
        const h = bitmap.height;
        if (!w || !h) {
            bitmap.close && bitmap.close();
            return fail();
        }

        const scale = Math.min(1, maxDim / Math.max(w, h));
        if (scale >= 1) {
            // Already smaller than the target — re-encoding would only add loss.
            // Tell the main thread to reuse the original blob as-is.
            bitmap.close && bitmap.close();
            return self.postMessage({ id, blob: null, passthrough: true });
        }

        const outW = Math.max(1, Math.round(w * scale));
        const outH = Math.max(1, Math.round(h * scale));

        const canvas = new OffscreenCanvas(outW, outH);
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
            bitmap.close && bitmap.close();
            return fail();
        }
        ctx.drawImage(bitmap, 0, 0, outW, outH);
        bitmap.close && bitmap.close();

        const outBlob = await canvas.convertToBlob({ type: mime, quality });
        if (!outBlob) return fail();

        self.postMessage({ id, blob: outBlob });
    } catch (err) {
        fail({ error: String((err && err.message) || err) });
    }
};
