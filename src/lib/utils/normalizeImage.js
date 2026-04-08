/**
 * Normalize camera images by baking EXIF orientation into pixels.
 *
 * On iOS, `<img>` renders with EXIF orientation applied, while some other APIs
 * (and width/height metadata) may behave inconsistently. By re-encoding once
 * via canvas, we ensure all downstream rendering + crop math sees the same
 * intrinsic pixel orientation.
 */
export async function normalizeImageFileToBlobUrl(file, opts = {}) {
    const { maxDim = 5200, quality = 0.95, mimeType = 'image/jpeg' } = opts;
    if (!file) return null;

    const srcUrl = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.decoding = 'async';
        img.src = srcUrl;

        if (img.decode) {
            // decode() is the best signal that the image is ready on mobile.
            await img.decode().catch(() => {});
        } else {
            await new Promise((res, rej) => {
                img.onload = res;
                img.onerror = rej;
            });
        }

        const w0 = img.naturalWidth || img.width || 0;
        const h0 = img.naturalHeight || img.height || 0;
        if (!w0 || !h0) return null;

        const scale = Math.min(1, maxDim / Math.max(w0, h0));
        const outW = Math.max(1, Math.round(w0 * scale));
        const outH = Math.max(1, Math.round(h0 * scale));

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, outW, outH);

        const outBlob = await new Promise((res) => canvas.toBlob(res, mimeType, quality));
        if (!outBlob) return null;

        return {
            url: URL.createObjectURL(outBlob),
            width: outW,
            height: outH,
            ratio: outW / outH
        };
    } finally {
        try { URL.revokeObjectURL(srcUrl); } catch {}
    }
}

